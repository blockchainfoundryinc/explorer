var mongoose = require('mongoose')
  , Schema = mongoose.Schema;
 
var AssetHistorySchema = new Schema({
  asset_id: { type: String, index: true},
  sender_address: { type: String, index: true},
  sender_alias: { type: String },
  txtxype: { type: String},
  vin: { type: Array },
  vout: { type: Array },
  txdata: { type: Object },
  height: { type: Number },
  txid: { type: String }
});

module.exports = mongoose.model('AssetHistory', AssetHistorySchema);

