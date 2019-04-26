const SyscoinRpcClient = require("syscoin-js").default;
const settings = require('./settings');
const Address = require('../models/address');
const Asset = require('../models/asset');
const lib = require('./explorer');
const utils = require('./utils');

let syscoinClient = new SyscoinRpcClient({baseUrl: settings.wallet.host, port: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass});

const syscoinDecodeRawTransaction = async (hex) => {
  try {
    //console.log("SYS decode raw tx:", hex);
    return await syscoinClient.callRpc("syscoindecoderawtransaction", [hex]);
  }catch(e) {
    console.log("ERR syscoinDecodeRawTransaction", e);
  }
};

const getAssetInfo = async (assetGuid) => {
  try {
    return await syscoinClient.callRpc("assetinfo", [assetGuid, false]);
  }catch(e) {
    console.log("ERR getAssetInfo", e);
  }
};

const getAssetAllocationInfo = async (assetGuid, ownerAddress) => {
  try {
    return await syscoinClient.callRpc("assetallocationinfo", [assetGuid, ownerAddress, false]);
  }catch(e) {
    console.log("ERR assetAllocationInfo", e);
  }
};

const listAssetAllocations = async (address) => {
  try {
    let filter = '{"receiver_address": "' + address +'"}';
    console.log(filter);
    return await syscoinClient.callRpc("listassetallocations", [0, 0, filter]);
  }catch(e) {
    console.log("ERR assetAllocationInfo", e);
  }
};

const prepareAssetVinVout = async (tx) => {
  let assetGuid, assetInfo, assetAllocationInfo, senderAddress, address;
  assetGuid = (await getAssetTxInfoFromHex(tx)).guid;
  const sysTx = await syscoinDecodeRawTransaction(tx.hex);

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
        if(!sysTx.owner) {
          utils.errorAndExit("Asset missing tx info.");
        }

        senderAddress = await getAliasAddress(sysTx.owner);
        address = await Address.findOne({a_id: senderAddress});

        //create inputs, use db balance
        if (address && address.asset_balances[assetGuid] !== undefined) {
          assetInputs.push({amount: address.asset_balances[assetGuid], address: address.a_id});
        } else {
          console.log("hex:", tx.hex);
          console.log("txid:", tx.txid);
          console.log("asset:", assetGuid);
          utils.errorAndExit("ERROR: Asset send without asset inputs! ");
        }

        //create outputs
        for (let i = 0; i < sysTx.allocations.length; i++) {
          let allocation = sysTx.allocations[i];
          //console.log(JSON.stringify(allocation));
          if(allocation.inputs === undefined) {
            assetOutputs.push({amount: parseFloat(allocation.amount), address: await getAliasAddress(allocation.owner)});
            sum += parseFloat(allocation.amount);
          //}else{ //handle atomic assets
          //  let outAmt = 0;
          //  for(let x = 0; x < allocation.inputs.length; x++) {
          //    let input = allocation.inputs[x];
          //    let amt = 0;
          //    if(input.start > input.end) {
          //      amt = input.start - input.end + 1;
          //    }else{
          //      amt = input.end - input.start + 1;
          //    }
          //
          //    outAmt += amt;
          //  }
          //
          //  assetOutputs.push({amount: parseFloat(outAmt), address: await getAliasAddress(allocation.owner)});
          //  sum += parseFloat(outAmt);
          }
        }

        let senderBalance = address.asset_balances[assetGuid];
        if(!isFinite(sum) || isNaN(sum) || !isFinite(senderBalance) || isNaN(senderBalance)) {
          console.log("SUM:", sum);
          console.log("Sender Balance:", senderBalance);
          console.log("ADDRESS.aid", address.a_id);
          console.log("Sender assets", address.asset_balances);
          console.log("Sender address:", senderAddress);
          utils.errorAndExit("Numbers gone crazy!");
        }

        //add an output for the change
        assetOutputs.push({amount: parseFloat(address.asset_balances[assetGuid] - sum), address: address.a_id});
        break;

      case 'assetactivate':
        if(!sysTx.owner || sysTx.owner.trim() === "") {
          utils.errorAndExit(`UNDEF OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo._id} is ${assetInfo.alias} txtype is ${sysTx.txtype}`);
        }

        //TODO: find a better way than using current supply!
        //add an output for the change
        assetOutputs.push({amount: parseFloat(assetInfo.total_supply), address: await getAliasAddress(sysTx.owner)});

        //create inputs
        assetInputs.push({amount: parseFloat(assetInfo.total_supply), address: 'coinbase'});
        break;

      case 'assetupdate':
        console.log("ASSET UPDATE!");
        console.log("TX:", tx);

        if(sysTx.balance) {
          //update the owner balance
          //create inputs
          assetInputs.push({amount: parseFloat(sysTx.balance), address: 'coinbase'});

          //add an output to current owner
          assetOutputs.push({amount: parseFloat(sysTx.balance), address: assetDbInfo.owner_address});
        }else{
          utils.errorAndExit("NO UPDATE DATA FOR tx");
        }
        break;

      case 'assettransfer':
        console.log("ASSET TRANSFER!");
        console.log("TX:", tx);

        //transfer the owner balance to new owner
        let newOwner = getInputAddress(tx).address;
        address = await Address.findOne({a_id: assetDbInfo.owner_address});

        //create inputs
        assetInputs.push({amount: parseFloat(address.asset_balances[assetGuid]), address: assetDbInfo.owner_address});

        //add an output to new owner
        assetOutputs.push({amount: parseFloat(address.asset_balances[assetGuid]), address: newOwner});

        //add empty change output
        assetOutputs.push({amount: 0, address: assetDbInfo.owner_address});

        //update the assetDB
        assetDbInfo.owner_address = newOwner;
        assetDbInfo.owner_alias = (await validateAddress(newOwner)).alias;
        assetDbInfo.last_update_height = tx.height;
        await assetDbInfo.save();
        break;
    }

    return {
      vin: assetInputs,
      vout: assetOutputs
    };
  }

  return {
    vin: [],
    vout: []
  }
};

const validateAddress = async(address) => {
  try {
    return await syscoinClient.callRpc("validateaddress", [address]);
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

const getAssetTxInfoFromHex = async (tx, getraw) => {
  const hex = tx.hex;
  //console.log("get asset info for tx: ", tx, "hex", hex);
  const sysTx = await syscoinDecodeRawTransaction(hex);

  if(getraw) {
    return sysTx;
  }

  let assetGuid, txtype = sysTx.txtype, assetSymbol, owner = sysTx.owner;
  switch(sysTx.txtype) {
    case "assetactivate":
      assetGuid = sysTx._id;
      assetSymbol = sysTx.symbol;
      break;

    case "assetsend":
      assetGuid = sysTx.asset;

      //TODO: remove in SYS4
      if(assetGuid) {
        assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      }else {
        utils.errorAndExit(`NO ASSET SYMBOL! ${tx.txid} HEX: ${hex}`);
      }
      break;

    case "assetallocationsend":
      assetGuid = sysTx.asset;
      assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      break;

    case 'assetupdate':
      assetGuid = sysTx._id;
      assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      break;

    case 'assettransfer':
      assetGuid = sysTx._id;
      assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      break;
  }

  return { guid: assetGuid, txtype, symbol: assetSymbol, owner: owner };
};

//TODO: refactor or remove entirely for 4
const getAliasAddress = async (alias) => {
  let address = alias;
  try {
    const aliasInfo = await syscoinClient.callRpc("aliasinfo", [alias]);
    address = aliasInfo.address;
  }catch(e) {
    console.log(`ERROR: ${alias} is not an alias`);
  }

  return address;
};


module.exports = {
  syscoinDecodeRawTransaction,
  getAssetInfo,
  getAssetAllocationInfo,
  listAssetAllocations,
  prepareAssetVinVout,
  getAssetTxInfoFromHex,
  getAliasAddress
};