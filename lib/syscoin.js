const LOG_LEVELS = require("syscoin-js/dist/loggers/log-levels");

const SyscoinRpcClient = require("syscoin-js").default;
const settings = require('./settings');

let syscoinClient = new SyscoinRpcClient({baseUrl: settings.wallet.host, port: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass, loggerLevel: LOG_LEVELS.trace});

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

const prepareAssetVinVout = async (hex) => {
  let assetGuid, assetInfo, assetAllocationInfo;
  assetGuid = await getAssetGuidFromHex(hex);
  const sysTx = await syscoinDecodeRawTransaction(hex);

  //create synthetic input/output
  let assetInputs = [], assetOutputs = [];
  if(assetGuid !== undefined) {
    console.log("ASSET PREPARE IN/OUT:", assetGuid);
    try {
      assetInfo = await getAssetInfo(assetGuid);
      //assetAllocationInfo = await getAssetAllocationInfo(assetGuid, assetInfo.alias);
    }catch(e) {
      //error will kick on assetactivate txs\
      console.log("SKIPPING ASSET ACTIVATE!");
      return {
        vin: assetInputs,
        vout: assetOutputs
      };
    }

    if(sysTx.txtype === 'assetsend' || sysTx.txtype === 'assetallocationsend') {
      //first create outputs
      let sum = 0;
      for(let i=0; i < sysTx.allocations.length; i ++) {
        let allocation = sysTx.allocations[i];
        //console.log(JSON.stringify(allocation));
        assetOutputs.push({amount: parseFloat(allocation.amount), address: await getAliasAddress(allocation.owner)});
        sum += parseFloat(allocation.amount);
      }

      //add an output for the change
      assetOutputs.push({amount: parseFloat(assetInfo.balance), address: await getAliasAddress(assetInfo.alias)});

      //create inputs
      assetInputs.push({amount: parseFloat(assetInfo.balance) + sum, address: await getAliasAddress(assetInfo.alias)});
    }
  }

  return {
    vin: assetInputs,
    vout: assetOutputs
  };
};

const getAssetGuidFromHex = async (hex) => {
  const sysTx = await syscoinDecodeRawTransaction(hex);
  let assetGuid;
  switch(sysTx.txtype) {
    case "assetsend":
    case "assetallocatioinsend":
      if (sysTx._id !== undefined && sysTx._id.length > 16) {
        assetGuid = sysTx.asset;
      }else{
        assetGuid = sysTx._id;
      }
      break;
  }

  return assetGuid;
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
  getAssetGuidFromHex,
  getAliasAddress
};