var mongoose = require('mongoose')
  , Schema = mongoose.Schema;
 
var AddressHistorySchema = new Schema({
  a_id: { type: String, index: true},
  txid: { type: String},
  balance: { type: String },
  balance_change: { type: String },
  assetType: {type: String},
  block: {type: Number},
  timestamp: {type: Number}
});

module.exports = mongoose.model('AddressHistory', AddressHistorySchema);

