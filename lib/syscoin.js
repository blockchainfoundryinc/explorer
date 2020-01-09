const client = require("@syscoin/syscoin-js");
const settings = require('./settings');
const Address = require('../models/address');
const Asset = require('../models/asset');
const lib = require('./explorer');
const utils = require('./utils');
const BigNumber = require('bignumber.js');

let syscoinClient = new client.SyscoinRpcClient({host: settings.wallet.host, rpcPort: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass});

const syscoinDecodeRawTransaction = async (hex) => {
  try {
    //console.log("SYS decode raw tx:", hex);
    return await syscoinClient.callRpc("syscoindecoderawtransaction", [hex]).call();
  }catch(e) {
    console.log("ERR syscoinDecodeRawTransaction", JSON.stringify(e.response.data.error));
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
    console.log("ERR assetAllocationInfo", JSON.stringify(e.response.data.error));
  }
};

const listAssetAllocations = async (address) => {
  try {
    let filter = '{"receiver_address": "' + address +'"}';
    console.log(filter);
    return await syscoinClient.callRpc("listassetallocations", [0, 0, filter]).call();
  }catch(e) {
    console.log("ERR assetAllocationInfo", JSON.stringify(e.response.data.error));
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

      let sum = new BigNumber(0);
      let senderBalance = new BigNumber(0);
      let senderChange = new BigNumber(0);
      switch (sysTx.txtype) {
        case 'syscoinburntoassetallocation':
          if (!sysTx.sender) {
            utils.errorAndExit("Asset missing sender info.");
          }

          senderAddress = sysTx.sender;
          address = await Address.findOne({a_id: senderAddress});
          console.log("syscoinburntoassetallocation:: Process sender balance. Sender address", senderAddress, 'address', address.a_id, sysTx);

          senderBalance = new BigNumber(address.asset_allocation_balances[assetGuid]);

          console.log("syscoinburntoassetallocation:: Sender Balance:", senderBalance, 'address', address.a_id);

          //create inputs
          assetInputs.push({amount: senderBalance.toFixed(), address: sysTx.sender});

          //create outputs
          for (let i = 0; i < sysTx.allocations.length; i++) {
            let allocation = sysTx.allocations[i];
            //console.log(JSON.stringify(allocation));
            assetOutputs.push({amount: new BigNumber(allocation.amount).toFixed(), address: allocation.address});
            sum.plus(new BigNumber(allocation.amount));
          }

          detectBadNumbers(sum, senderBalance, address);

          //add an output for the change, amount varies based on if its a send or an allocation
          senderChange = new BigNumber(address.asset_allocation_balances[assetGuid]).minus(sum);

          console.log("syscoinburntoassetallocation:: SENDER CHANGE: change", senderChange.toFixed(), "balance", address.asset_allocation_balances[assetGuid], "sendsum", sum.toFixed());
          assetOutputs.push({amount: senderChange.toFixed(), address: address.a_id});
          break;

        case 'assetsend':
        case 'assetallocationsend':
        case 'assetallocationburn':
          if (!sysTx.sender) {
            utils.errorAndExit("Asset missing sender info.");
          }

          senderAddress = sysTx.sender;
          address = await Address.findOne({a_id: senderAddress});
          console.log("Process sender balance. Sender address", senderAddress, 'address', address.a_id, sysTx);

          if(sysTx.txtype === 'assetsend') {
            senderBalance = new BigNumber(address.asset_balances[assetGuid]);
          }else{
            senderBalance = new BigNumber(address.asset_allocation_balances[assetGuid]);
          }

          console.log("Sender Balance:", senderBalance.toFixed(), 'address', address.a_id);

          //create inputs
          assetInputs.push({amount: senderBalance.toFixed(), address: address.a_id});

          //create outputs
          for (let i = 0; i < sysTx.allocations.length; i++) {
            let allocation = sysTx.allocations[i];
            //console.log(JSON.stringify(allocation));
            assetOutputs.push({amount: new BigNumber(allocation.amount).toFixed(), address: allocation.address});
            sum.plus(new BigNumber(allocation.amount));
          }

          detectBadNumbers(sum, senderBalance, address);

          //add an output for the change, amount varies based on if its a send or an allocation
          if(sysTx.txtype === 'assetsend') {
            senderChange = new BigNumber(address.asset_balances[assetGuid]).minus(sum);
          }else{
            senderChange = new BigNumber(address.asset_allocation_balances[assetGuid]).minus(sum);
          }

          console.log("SENDER CHANGE: change", senderChange.toFixed(), "balance", address.asset_allocation_balances[assetGuid], "sendsum", sum.toFixed());
          assetOutputs.push({amount: senderChange.toFixed(), address: address.a_id});
          break;

        case 'assetactivate':
          if (!sysTx.sender || sysTx.sender.trim() === "") {
            utils.errorAndExit(`UNDEF OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo.asset_guid} is ${assetInfo.address} txtype is ${sysTx.txtype}`);
          }

          let balance = new BigNumber(0);
          if (sysTx.balance) {
            balance = new BigNumber(sysTx.balance);
          }

          //create inputs
          assetInputs.push({amount: balance.toFixed(), address: 'coinbase'});

          //create outputs
          assetOutputs.push({amount: balance.toFixed(), address: sysTx.sender});
          break;

        //TODO: write asset history?
        case 'assetupdate':
          console.log("ASSET UPDATE!");

          if (sysTx.balance) {
            //update the owner balance
            //create inputs
            assetInputs.push({amount: new BigNumber(sysTx.balance).toFixed(), address: 'coinbase'});

            //add an output to current owner
            assetOutputs.push({amount: new BigNumber(sysTx.balance).toFixed(), address: sysTx.sender});
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
          assetInputs.push({amount: new BigNumber(address.asset_balances[assetGuid]).toFixed(), address: sysTx.sender});

          //add an output to new owner
          assetOutputs.push({amount: new BigNumber(address.asset_balances[assetGuid]).toFixed(), address: newOwner});

          //add empty change output
          assetOutputs.push({amount: "0", address: sysTx.sender});

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
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR validateAddress", err);
    throw err;
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
    console.log('assetallocationsend', assetGuid, senderAddress, receiverAddress, amount);
    return await syscoinClient.callRpc("assetallocationsend", [parseFloat(assetGuid), senderAddress, receiverAddress, parseFloat(amount)]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR assetAllocationSend", err);
    throw err;
  }
};


const sendFrom = async (fundingAddress, address, amount) => {
  try {
    return await syscoinClient.callRpc("sendfrom", [fundingAddress, address, amount]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR sendFrom", err);
    throw err;
  }
};

const decodeRawTransaction = async (hex) => {
  try {
    return await syscoinClient.callRpc("decoderawtransaction", [hex]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR decodeRawTransaction", err);
    throw err;
  }
};

const getTxListDetails = async (txIds) => {
  try {
    let requests = [];
    txIds.forEach(txid => {
      requests.push(syscoinClient.callRpc("getrawtransaction", [txid, 1]));
    });

    return await syscoinClient.batch(requests);
  }catch(e) {
    console.log("ERR sendFrom", JSON.stringify(e.response.data.error));
  }
};

const getRawTransactionBatch = async (outData) => {
  try {
    let requests = [];
    outData.forEach(out => {
      console.log(`${out.txid}-${out.index}`);

      // TODO: this can be optimized for uniqueness
      requests.push(syscoinClient.callRpc("getrawtransaction", [out.txid, 1]));
    });

    let result = await syscoinClient.batch(requests);
    console.log("batched:", result);
    let response = {};

    // map results back to txids
    result.forEach((tx, index) => {
      const output = tx.vout[ outData[index].index ];
      response[`${tx.txid}-${outData[index].index}`] = output;
    });

    console.log('result:', response);
    return response;
  }catch(e) {
    console.log("ERR getRawTransactionBatch", JSON.stringify(e.response.data.error));
  }
};

const getTxOutBatch = async (outData) => {
  try {
    let requests = [];
    outData.forEach(out => {
      requests.push(syscoinClient.callRpc("gettxout", [out.txid, out.index]));
    });

    let result = await syscoinClient.batch(requests);
    console.log("batched:", result);
    let response = {};

    // map results back to txids
    result.forEach((output, index) => {
      response[`${outData[index].txid}-${outData[index].index}`] = output;
    });

    console.log('result:', response);
    return response;
  }catch(e) {
    console.log("ERR getTxOutBatch", JSON.stringify(e.response.data.error));
  }
};

const sendRawTransaction = async (signedHex) => {
  try {
    return await syscoinClient.callRpc("sendrawtransaction", [signedHex]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR sendRawTransaction", err);
    throw err;
  }
};

const decodeScript = async (hex) => {
  try {
    return await syscoinClient.callRpc("decodescript", [hex]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR decodeScript", err);
    throw err;
  }
};

const convertAddress = async (address) => {
  try {
    return await syscoinClient.callRpc("convertaddress", [address]).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR convertAddress", err);
    throw err;
  }
};

function detectBadNumbers(sum, senderBalance, address) {
  if (!isFinite(sum.toNumber()) || isNaN(sum.toNumber()) || !isFinite(senderBalance.toNumber()) || isNaN(senderBalance.toNumber()) || senderBalance.toNumber() < 0) {
    console.log("SUM:", sum.toFixed());
    console.log("ADDRESS.aid", address.a_id);
    console.log("Sender assets", address.asset_balances);
    utils.errorAndExit("Numbers gone crazy or double spend!");
  }
}

const getChainTips = async (address) => {
  try {
    return await syscoinClient.callRpc("getchaintips", []).call();
  }catch(e) {
    const err = JSON.stringify(e.response.data.error);
    console.log("ERR getChainTips", err);
    throw err;
  }
};

module.exports = {
  getAssetInfo,
  getAssetAllocationInfo,
  listAssetAllocations,
  prepareAssetVinVout,
  assetAllocationSend,
  sendFrom,
  getTxListDetails,
  getRawTransactionBatch,
  decodeRawTransaction,
  getTxOutBatch,
  sendRawTransaction,
  decodeScript,
  convertAddress,
  getChainTips
};
