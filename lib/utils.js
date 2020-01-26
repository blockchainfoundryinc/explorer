const BigNumber = require('bignumber.js');
const AddressHistory = require('../models/addresshistory');


function numberWithCommas(x, digits) {
  let ret = new BigNumber(x).toFixed(digits);
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
    balance: balance || 0,
    allocation_balance: allocated_balance || 0,
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
    assetBalances[alloc_guid] = createAssetBalance(alloc_guid, assetInfo, address, numberWithCommas(address.asset_allocation_balances[alloc_guid], 8));
  }

  //go through the un-allocated balances if any, and update the entries or create new entry
  for (let guid in address.asset_balances) {
    let assetInfo = await syscoinHelper.getAssetInfo(guid);
    if(assetBalances[guid]) {
      assetBalances[guid].balance = numberWithCommas(address.asset_balances[guid], 8);
    } else {
      assetBalances[guid] = createAssetBalance(guid, assetInfo, address, 0, numberWithCommas(address.asset_balances[guid], 8));
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
  const syscoinHelper = require('./syscoin');
  let decoded = await syscoinHelper.decodeRawTransaction(rawtx);
  let vinMap = [];
  decoded.vin.forEach(vin => {
    vinMap.push({ txid: vin.txid, index: vin.vout });
  });
  let prevOuts = await syscoinHelper.getTxOutBatch(vinMap);

  return prevOuts;
}

function saveAddressHistory(a_id, txid, start_balance, end_balance, balance_change, assetType, block, timestamp) {
  //log address history
  let addressHistory;
  if(assetType !== "SYS") {
    addressHistory = new AddressHistory({
      a_id,
      txid,
      start_balance,
      end_balance,
      balance_change,
      assetType,
      block,
      timestamp
    });
  }else{
    addressHistory = new AddressHistory({
      a_id,
      txid,
      start_balance,
      end_balance,
      balance_change,
      assetType,
      block,
      timestamp
    });
  }

  addressHistory.save(function(err) {
    if (err) {
      console.log('Error saving address history!!');
    }
  });
}

module.exports = {
  numberWithCommas,
  errorAndExit,
  buildAssetBalanceList,
  findOutput,
  getPrevOutsFromRawTx,
  saveAddressHistory
};
