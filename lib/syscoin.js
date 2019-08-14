const client = require("@syscoin/syscoin-js");
const settings = require('./settings');
const Address = require('../models/address');
const Asset = require('../models/asset');
const lib = require('./explorer');
const utils = require('./utils');

let syscoinClient = new client.SyscoinRpcClient({host: settings.wallet.host, rpcPort: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass});

const syscoinDecodeRawTransaction = async (hex) => {
  try {
    //console.log("SYS decode raw tx:", hex);
    return await syscoinClient.callRpc("syscoindecoderawtransaction", [hex]).call();
  }catch(e) {
    console.log("ERR syscoinDecodeRawTransaction", e);
  }
};

const getAssetInfo = async (assetGuid) => {
  try {
    return await syscoinClient.callRpc("assetinfo", [+assetGuid]).call();
  }catch(e) {
    console.log("ERR getAssetInfo", assetGuid, JSON.stringify(e.response.data.error));
  }
};

const getAssetAllocationInfo = async (assetGuid, ownerAddress) => {
  try {
    return await syscoinClient.callRpc("assetallocationinfo", [+assetGuid, ownerAddress, false]).call();
  }catch(e) {
    console.log("ERR assetAllocationInfo", e);
  }
};

const listAssetAllocations = async (address) => {
  try {
    let filter = '{"receiver_address": "' + address +'"}';
    console.log(filter);
    return await syscoinClient.callRpc("listassetallocations", [0, 0, filter]).call();
  }catch(e) {
    console.log("ERR assetAllocationInfo", e);
  }
};

const prepareAssetVinVout = async (tx) => {
  let assetGuid, assetInfo, senderAddress, address;
  const sysTx = tx.systx;

  if(sysTx) {
    assetGuid = sysTx.asset_guid;

    //create synthetic input/output
    let assetInputs = [], assetOutputs = [], assetDbInfo;
    if (assetGuid !== undefined) {
      console.log("ASSET PREPARE IN/OUT:", assetGuid);
      assetInfo = await getAssetInfo(assetGuid);
      assetDbInfo = await Asset.findOne({asset_id: assetGuid});

      let sum = 0;
      switch (sysTx.txtype) {
        case 'assetsend':
        case 'assetallocationsend':
        case 'assetallocationburn':
          if (!sysTx.sender) {
            utils.errorAndExit("Asset missing sender info.");
          }

          senderAddress = sysTx.sender;
          address = await Address.findOne({a_id: senderAddress});

          let senderBalance;
          if(sysTx.txtype === 'assetsend') {
            senderBalance = address.asset_balances[assetGuid];
          }else{
            senderBalance = address.asset_allocation_balances[assetGuid];
          }
          console.log("Sender Balance:", senderBalance, 'address', address.a_id);

          //create inputs
          assetInputs.push({amount: senderBalance, address: address.a_id});

          //create outputs
          for (let i = 0; i < sysTx.allocations.length; i++) {
            let allocation = sysTx.allocations[i];
            //console.log(JSON.stringify(allocation));
            assetOutputs.push({amount: parseFloat(allocation.amount), address: allocation.address});
            sum += parseFloat(allocation.amount);
          }

          if (!isFinite(sum) || isNaN(sum) || !isFinite(senderBalance) || isNaN(senderBalance) || senderBalance < 0) {
            console.log("SUM:", sum);
            console.log("ADDRESS.aid", address.a_id);
            console.log("Sender assets", address.asset_balances);
            console.log("Sender address:", senderAddress);
            utils.errorAndExit("Numbers gone crazy or double spend!");
          }

          //add an output for the change, amount varies based on if its a send or an allocation
          let senderChange;
          if(sysTx.txtype === 'assetsend') {
            senderChange = address.asset_balances[assetGuid] - sum;
          }else{
            senderChange = address.asset_allocation_balances[assetGuid] - sum;
          }

          //fix precision issue
          senderChange = +(senderChange).toFixed(8);
          console.log("SENDER CHANGE: change", senderChange, "balance", address.asset_allocation_balances[assetGuid], "sendsum", sum);
          assetOutputs.push({amount: parseFloat(senderChange), address: address.a_id});
          break;

        case 'assetactivate':
          if (!sysTx.sender || sysTx.sender.trim() === "") {
            utils.errorAndExit(`UNDEF OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo.asset_guid} is ${assetInfo.address} txtype is ${sysTx.txtype}`);
          }

          //create inputs
          assetInputs.push({amount: parseFloat(sysTx.balance), address: 'coinbase'});

          //create outputs
          assetOutputs.push({amount: parseFloat(sysTx.balance), address: sysTx.sender});
          break;

        //TODO: write asset history?
        case 'assetupdate':
          console.log("ASSET UPDATE!");

          if (sysTx.balance) {
            //update the owner balance
            //create inputs
            assetInputs.push({amount: parseFloat(sysTx.balance), address: 'coinbase'});

            //add an output to current owner
            assetOutputs.push({amount: parseFloat(sysTx.balance), address: sysTx.sender});
          } else {
            console.log("NO UPDATE DATA FOR tx", tx.txid);
          }
          break;

        case 'assettransfer':
          console.log("ASSET TRANSFER!");
          console.log("TX:", tx);

          //transfer the owner balance to new owner
          let newOwner = sysTx.address_transfer;
          address = await Address.findOne({a_id: sysTx.sender});

          //create inputs
          assetInputs.push({amount: parseFloat(address.asset_balances[assetGuid]), address: sysTx.sender});

          //add an output to new owner
          assetOutputs.push({amount: parseFloat(address.asset_balances[assetGuid]), address: newOwner});

          //add empty change output
          assetOutputs.push({amount: 0, address: sysTx.sender});

          //update the assetDB
          assetDbInfo.owner_address = newOwner;
          assetDbInfo.last_update_height = tx.height;
          await assetDbInfo.save();
          break;
      }

      return {
        vin: assetInputs,
        vout: assetOutputs
      };
    }
  }

  return {
    vin: [],
    vout: []
  }
};

const validateAddress = async(address) => {
  try {
    return await syscoinClient.callRpc("validateaddress", [address]).call();
  }catch(e) {
    console.log("ERR validateAddress", e);
  }
};

//TODO: refactor for 4? use systx data?
const getInputAddress = (tx) => {
  //pull input from vin
  let largest_vout = { address: "", amount: 9999999999999999 };
  let vout;
  for(let vout_index in tx.vout) {
    vout = tx.vout[vout_index];
    //console.log("VOUT:", JSON.stringify(vout));
    if(vout.scriptPubKey.addresses !== undefined && largest_vout.amount > vout.value) {
      largest_vout = { address: vout.scriptPubKey.addresses[0], amount: vout.value };
    }
  }

  console.log("largest vout:", JSON.stringify(largest_vout));
  return largest_vout;
};

const assetAllocationSend = async (assetGuid, senderAddress, receiverAddress, amount) => {
  try {
    return await syscoinClient.callRpc("assetallocationsend", [assetGuid, senderAddress, receiverAddress, amount]).call();
  }catch(e) {
    console.log("ERR assetAllocationSend", e);
  }
};


const sendFrom = async (fundingAddress, address, amount) => {
  try {
    return await syscoinClient.callRpc("sendfrom", [fundingAddress, address, amount]).call();
  }catch(e) {
    console.log("ERR sendFrom", e);
  }
};

const getTxListDetails = async (txIds) => {
  try {
    let requests = [];
    txIds.forEach(txid => {
      requests.push(syscoinClient.callRpc("gettransaction", [txid]));
    });

    return await syscoinClient.batch(requests);
  }catch(e) {
    console.log("ERR sendFrom", e);
  }
};

module.exports = {
  getAssetInfo,
  getAssetAllocationInfo,
  listAssetAllocations,
  prepareAssetVinVout,
  assetAllocationSend,
  sendFrom,
  getTxListDetails
};
