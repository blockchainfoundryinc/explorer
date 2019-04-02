var mongoose = require('mongoose')
  , Schema = mongoose.Schema;
 
var AssetSchema = new Schema({
  asset_id: { type: String, unique: true, index: true},
  owner_address: { type: String, index: true},
  last_update_height: { type: Number }
}, {id: false});

module.exports = mongoose.model('Asset', AssetSchema);

