const syscoinHelper = require('./syscoin');

function numberWithCommas(x, digits) {
  let ret = parseFloat(x.toFixed(digits)).toLocaleString('en', {minimumFractionDigits : 2, maximumFractionDigits: digits});
  console.log('numberwcommas:', x, ret);

  return ret;
}

function errorAndExit(msg) {
  console.log(msg);
  throw new Error(msg);
  process.exit(22);
}

function createAssetBalance(guid, assetInfo, address, allocated_balance = 0, balance = 0) {
  return {
    asset_guid: guid,
    symbol: assetInfo.symbol,
    balance: balance,
    allocation_balance: allocated_balance.toString(),
    asset_publicvalue: assetInfo.public_value,
    isOwner: assetInfo.address === address.a_id,
    owner_address: assetInfo.address
  };
}

async function buildAssetBalanceList(address) {
  const syscoinHelper = require('./syscoin');
  let assetBalances = {};

  // TODO refactor this at DB level so balances are not in 2 diff objects
  //go through allocated balances and assign or create more fields
  for (let alloc_guid in address.asset_allocation_balances) {
    let assetInfo = await syscoinHelper.getAssetInfo(alloc_guid);
    assetBalances[alloc_guid] = createAssetBalance(alloc_guid, assetInfo, address, address.asset_allocation_balances[alloc_guid]);
  }

  //go through the un-allocated balances if any, and update the entries or create new entry
  for (let guid in address.asset_balances) {
    if(assetBalances[guid]) {
      assetBalances[guid].balance = address.asset_balances[guid];
    } else {
      assetBalances[guid] = createAssetBalance(guid, assetInfo, address, 0, address.asset_balances[guid])
    }
  }

  return assetBalances;
}

function findOutput(txid, index, outArr) {
  //for (let i = 0; i < outArr.length; i++) {
  //  if (outArr[i].txid === txid && outArr[i].index === )
  //}
}

async function getPrevOutsFromRawTx(rawtx) {
  let decoded = await syscoinHelper.decodeRawTransaction(rawtx);
  let vinMap = [];
  decoded.vin.forEach(vin => {
    vinMap.push({ txid: vin.txid, index: vin.vout });
  });
  let prevOuts = await syscoinHelper.getRawTransactionBatch(vinMap);

  return prevOuts;
}

module.exports = {
  numberWithCommas,
  errorAndExit,
  buildAssetBalanceList,
  findOutput,
  getPrevOutsFromRawTx
};
