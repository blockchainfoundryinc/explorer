var mongoose = require('mongoose')
  , Schema = mongoose.Schema;
 
var AddressSchema = new Schema({
  a_id: { type: String, unique: true, index: true},
  txs: { type: Array, default: [] },
  received: { type: String, default: 0 },
  sent: { type: String, default: 0 },
  balance: {type: String, default: 0},
  asset_balances: {type: Object, default: {}},
  asset_allocation_balances: {type: Object, default: {}}
}, {id: false});

module.exports = mongoose.model('Address', AddressSchema);

