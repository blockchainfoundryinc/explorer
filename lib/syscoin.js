const SyscoinRpcClient = require("syscoin-js").default;
let syscoinClient = new SyscoinRpcClient({baseUrl: "localhost", port: 8368, username: 'u', password: 'p'});

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