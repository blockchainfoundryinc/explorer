const SyscoinRpcClient = require("syscoin-js").default;
const settings = require('./settings');
const Address = require('../models/address');
const lib = require('./explorer');

let syscoinClient = new SyscoinRpcClient({baseUrl: settings.wallet.host, port: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass});

const syscoinDecodeRawTransaction = async (hex) => {
  try {
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
  let assetGuid, assetInfo, assetAllocationInfo, ownerAddress, address;
  assetGuid = (await getAssetTxInfoFromHex(tx.hex)).guid;
  const sysTx = await syscoinDecodeRawTransaction(tx.hex);

    //create synthetic input/output
    let assetInputs = [], assetOutputs = [];
    if (assetGuid !== undefined) {
      console.log("ASSET PREPARE IN/OUT:", assetGuid);
      assetInfo = await getAssetInfo(assetGuid);

      let sum = 0;
      switch (sysTx.txtype) {
        case 'assetsend':
        case 'assetallocationsend':

          ownerAddress = await getAliasAddress(sysTx.owner);
          address = await Address.findOne({a_id: ownerAddress});

          //create inputs, use db balance
          if (address && address.asset_balances[assetGuid] !== undefined) {
            assetInputs.push({amount: address.asset_balances[assetGuid], address: ownerAddress});
          } else {
            console.log("ERROR: Asset send without asset inputs! ");
            console.log("hex:", tx.hex);
            console.log("txid:", tx.txid);
            console.log("asset:", assetGuid);

            //pull input from vin
            let smallest_vout = { address: "", amount: 9999999999999999 };
            let vout;
            for(let vout_index in tx.vout) {
              vout = tx.vout[vout_index];
              console.log("VOUT:", JSON.stringify(vout));
              if(smallest_vout.amount > vout.value) {
                smallest_vout = { address: vout.scriptPubKey.addresses[0], amount: vout.value };
              }
            }

            console.log("largest vout:", JSON.stringify(smallest_vout));
            assetInputs.push(smallest_vout);
          }

          //create outputs
          for (let i = 0; i < sysTx.allocations.length; i++) {
            let allocation = sysTx.allocations[i];
            //console.log(JSON.stringify(allocation));
            assetOutputs.push({amount: parseFloat(allocation.amount), address: await getAliasAddress(allocation.owner)});
            sum += parseFloat(allocation.amount);
          }

          //add an output for the change
          assetOutputs.push({amount: parseFloat(address.asset_balances[assetGuid] - sum), address: ownerAddress});
          break;

        case 'assetactivate':
          //TODO: find a better way than using current supply!
          //add an output for the change
          assetOutputs.push({amount: parseFloat(assetInfo.total_supply), address: await getAliasAddress(assetInfo.alias)});

          //create inputs
          assetInputs.push({amount: parseFloat(assetInfo.total_supply), address: 'coinbase'});
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

const getAssetTxInfoFromHex = async (hex) => {
  const sysTx = await syscoinDecodeRawTransaction(hex);
  let assetGuid, txtype = sysTx.txtype, assetSymbol;
  switch(sysTx.txtype) {
    case "assetactivate":
      assetGuid = sysTx._id;
      assetSymbol = sysTx.symbol;
      break;
    case "assetsend":
      assetGuid = sysTx.asset;
      assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      break;
    case "assetallocationsend":
      assetGuid = sysTx.asset;
      assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      break;
  }

  return { guid: assetGuid, txtype, symbol: assetSymbol };
};

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
  getAssetGuidFromHex: getAssetTxInfoFromHex,
  getAliasAddress
};