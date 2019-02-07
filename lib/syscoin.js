const SyscoinRpcClient = require("syscoin-js").default;
const settings = require('./settings');
let syscoinClient = new SyscoinRpcClient({baseUrl: settings.wallet.host, port: settings.wallet.port, username: settings.wallet.user, password: settings.wallet.pass});

const syscoinDecodeRawTransaction = async (hex) => {
  try {
    return await syscoinClient.callRpc("syscoindecoderawtransaction", [hex]);
  }catch(e) {
    console.log("ERR syscoinDecodeRawTransaction", e);
  }
};

const assetInfo = async (assetGuid) => {
  try {
    return await syscoinClient.callRpc("assetinfo", [assetGuid, false]);
  }catch(e) {
    console.log("ERR getAssetInfo", e);
  }
};

module.exports = {
  syscoinDecodeRawTransaction,
  assetInfo
};