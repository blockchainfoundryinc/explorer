const SyscoinRpcClient = require("syscoin-js").default;
const settings = require('./settings');
const Address = require('../models/address');
const lib = require('./explorer');

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
    let assetInputs = [], assetOutputs = [];
    if (assetGuid !== undefined) {
      console.log("ASSET PREPARE IN/OUT:", assetGuid);
      assetInfo = await getAssetInfo(assetGuid);

      let sum = 0;
      switch (sysTx.txtype) {
        case 'assetsend':
        case 'assetallocationsend':

          if(!sysTx.owner) {
            console.log(`UNDEF OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo._id} is ${assetInfo.alias} txtype is ${sysTx.txtype}`);
            sysTx.owner = assetInfo.alias;
          }else if(sysTx.owner.trim() === "") {
            console.log(`BLANK OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo._id} is ${assetInfo.alias} txtype is ${sysTx.txtype}`);
            sysTx.owner = assetInfo.alias;
          }

          senderAddress = await getAliasAddress(sysTx.owner);
          address = await Address.findOne({a_id: senderAddress});

          //create inputs, use db balance
          if (address && address.asset_balances[assetGuid] !== undefined) {
            assetInputs.push({amount: address.asset_balances[assetGuid], address: address.a_id});
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
              if(vout.scriptPubKey.addresses !== undefined && smallest_vout.amount > vout.value) {
                smallest_vout = { address: vout.scriptPubKey.addresses[0], amount: vout.value };
              }
            }

            console.log("largest vout:", JSON.stringify(smallest_vout));
            assetInputs.push(smallest_vout);

            //get owner address from db
            address = await Address.findOne({a_id: smallest_vout.address});
          }

          //create outputs
          for (let i = 0; i < sysTx.allocations.length; i++) {
            let allocation = sysTx.allocations[i];
            //console.log(JSON.stringify(allocation));
            if(allocation.inputs === undefined) {
              assetOutputs.push({amount: parseFloat(allocation.amount), address: await getAliasAddress(allocation.owner)});
              sum += parseFloat(allocation.amount);
            }else{ //handle atomic assets
              let outAmt = 0;
              for(let x = 0; x < allocation.inputs.length; x++) {
                let input = allocation.inputs[x];
                let amt = 0;
                if(input.start > input.end) {
                  amt = input.start - input.end + 1;
                }else{
                  amt = input.end - input.start + 1;
                }

                outAmt += amt;
              }

              assetOutputs.push({amount: parseFloat(outAmt), address: await getAliasAddress(allocation.owner)});
              sum += parseFloat(outAmt);
            }
          }

          let senderBalance = address.asset_balances[assetGuid];
          if(!isFinite(sum) || isNaN(sum) || !isFinite(senderBalance) || isNaN(senderBalance)) {
            console.log("Numbers gone crazy!");
            console.log("SUM:", sum);
            console.log("Sender Balance:", senderBalance);
            console.log("ADDRESS.aid", address.a_id);
            console.log("Sender assets", address.asset_balances);
            console.log("Sender address:", senderAddress);
            process.exit(22);
          }

          //add an output for the change
          assetOutputs.push({amount: parseFloat(address.asset_balances[assetGuid] - sum), address: address.a_id});
          break;

        case 'assetactivate':
          if(!sysTx.owner || sysTx.owner.trim() === "") {
            console.log(`UNDEF OWNER Asset owner is blank, using assetinfo. Owner for ${assetInfo._id} is ${assetInfo.alias} txtype is ${sysTx.txtype}`);
            sysTx.owner = assetInfo.alias;
          }

          //TODO: find a better way than using current supply!
          //add an output for the change
          assetOutputs.push({amount: parseFloat(assetInfo.total_supply), address: await getAliasAddress(sysTx.owner), isOwner: true});

          //create inputs
          assetInputs.push({amount: parseFloat(assetInfo.total_supply), address: 'coinbase'});
          break;

        case 'assetupdate':
          console.log("ASSET UPDATE!");
          console.log("TX:", tx);
          process.exit(22);
          break;

        case 'assettransfer':
          console.log("ASSET TRANSFER!");
          console.log("TX:", tx);
          process.exit(22);
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

const getAssetTxInfoFromHex = async (tx) => {
  const hex = tx.hex;
  //console.log("get asset info for tx: ", tx, "hex", hex);
  const sysTx = await syscoinDecodeRawTransaction(hex);
  let assetGuid, txtype = sysTx.txtype, assetSymbol;
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
      }else{
        console.log("NO ASSET SYMBOL! ", tx.txid, "HEX: ", hex);

        //try to pull it from public value
        assetGuid = sysTx.publicvalue;
        console.log("Trying: ", assetGuid);
        assetSymbol = (await getAssetInfo(assetGuid)).symbol;
      }
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
  getAssetTxInfoFromHex,
  getAliasAddress
};