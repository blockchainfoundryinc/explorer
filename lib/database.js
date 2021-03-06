var mongoose = require('mongoose')
  , Stats = require('../models/stats')
  , Markets = require('../models/markets')
  , Address = require('../models/address')
  , Tx = require('../models/tx')
  , Richlist = require('../models/richlist')
  , Peers = require('../models/peers')
  , Heavy = require('../models/heavy')
  , lib = require('./explorer')
  , settings = require('./settings')
  , poloniex = require('./markets/poloniex')
  , bittrex = require('./markets/bittrex')
  , bleutrade = require('./markets/bleutrade')
  , cryptsy = require('./markets/cryptsy')
  , cryptopia = require('./markets/cryptopia')
  , yobit = require('./markets/yobit')
  , empoex = require('./markets/empoex')
  , ccex = require('./markets/ccex')
  , syscoinHelper = require('./syscoin')
  , Asset = require('../models/asset')
  , AssetHistory = require('../models/assethistory')
  , AddressHistory = require('../models/addresshistory')
  , utils = require('./utils')
  , BigNumber = require('bignumber.js');
//  , BTC38 = require('./markets/BTC38');

function find_address(hash, cb) {
  Address.findOne({a_id: hash}, function(err, address) {
    if(address) {
      return cb(address);
    } else {
      return cb();
    }
  });
}

function find_richlist(coin, cb) {
  Richlist.findOne({coin: coin}, function(err, richlist) {
    if(richlist) {
      return cb(richlist);
    } else {
      return cb();
    }
  });
}

function update_address(hash, txid, amount, type, asset_guid, vindex, length, tx, blockheight, cb) {
  amount = new BigNumber(amount);
  // Check if address exists
  let s_timer = new Date().getTime();
  find_address(hash, function(address) {
    if (address) {
      // if coinbase (new coins PoW), update sent only and return cb.
      if ( hash === 'coinbase' ) {
        Address.update({a_id:hash}, {
          sent: new BigNumber(address.sent).plus(amount).toFixed(),
		      balance: 0,
        }, function() {
          return cb();
        });
      } else {
        // ensure tx doesnt already exist in address.txs
        let startBalance = new BigNumber(0);
        lib.is_unique(address.txs, txid, async function(unique, index) {
          // console.log('unique check:', hash, address.txs.length, new Date().getTime() - s_timer);

          var tx_array = address.txs;
          var received = new BigNumber(address.received);
          var sent = new BigNumber(address.sent);
          var asset_balances = address.asset_balances;
          var asset_allocation_balances = address.asset_allocation_balances;

          if(asset_guid != null) {
            console.log(`BEFORE UPDATE ${address.a_id}: Balances for ${asset_guid}: unallocated: ${asset_balances[asset_guid]} | allocated: ${asset_allocation_balances[asset_guid]}`);
            startBalance = asset_allocation_balances[asset_guid] ? new BigNumber(asset_allocation_balances[asset_guid]) : new BigNumber(0);
          } else {
            startBalance = new BigNumber(address.balance);
          }

          let delta = new BigNumber(0);
          switch(type) {
            case 'vin':
              sent = sent.plus(amount);
              delta = delta.plus(amount);
              break;
            case 'vout':
              received = received.plus(amount);
              delta = delta.plus(amount);
              break;
            case 'asset_vin':
              if(tx.systx.txtype === 'assettransfer' || tx.systx.txtype === 'assetactivate' || tx.systx.txtype === 'assetsend') {
                asset_balances[asset_guid] = new BigNumber(asset_balances[asset_guid]).minus(amount).toFixed();
                delta = delta.minus(amount);
              }else if(tx.systx.txtype === 'assetallocationsend' ||
                  tx.systx.txtype === 'syscoinburntoassetallocation' ||
                  tx.systx.txtype === 'assetallocationmint' ||
                  tx.systx.txtype === 'assetallocationburntoethereum') {
                asset_allocation_balances[asset_guid] = new BigNumber(asset_allocation_balances[asset_guid]).minus(amount).toFixed();
                delta = delta.minus(amount);
              }
              break;
            case 'asset_vout':
              //if there is no existing asset activity, init to 0
              if(asset_balances[asset_guid] === undefined && (tx.systx.txtype === 'assettransfer' || tx.systx.txtype === 'assetactivate')) {
                  asset_balances[asset_guid] = amount.toFixed();
                  delta = amount;
              }else if(asset_allocation_balances[asset_guid] === undefined &&
                  (tx.systx.txtype === 'assetallocationsend' ||
                      tx.systx.txtype === 'assetsend' ||
                      tx.systx.txtype === 'syscoinburntoassetallocation' ||
                      tx.systx.txtype === 'assetallocationmint' ||
                      tx.systx.txtype === 'assetallocationburntoethereum')) {

                if(tx.systx.txtype !== 'assetsend') {
                  asset_allocation_balances[asset_guid] = amount.toFixed();
                  delta = amount;
                }else if(tx.systx.txtype === 'assetsend') {
                  if(vindex === length-1) { //change back to asset owner
                    asset_balances[asset_guid] = amount.toFixed();
                    delta = amount;
                  }else{ //allocation
                    asset_allocation_balances[asset_guid] = amount.toFixed();
                    delta = amount;
                  }
                }
              }else{
                if(tx.systx.txtype === 'assettransfer' || tx.systx.txtype === 'assetactivate' || tx.systx.txtype === 'assetupdate') {
                  asset_balances[asset_guid] = new BigNumber(asset_balances[asset_guid]).plus(amount).toFixed();
                  delta = delta.plus(amount)
                }else if(tx.systx.txtype === 'assetallocationsend' ||
                    tx.systx.txtype === 'syscoinburntoassetallocation' ||
                    tx.systx.txtype === 'assetallocationmint' ||
                    tx.systx.txtype === 'assetallocationburntoethereum') {
                  asset_allocation_balances[asset_guid] = new BigNumber(asset_allocation_balances[asset_guid]).plus(amount).toFixed();
                  delta = delta.plus(amount);
                }else if(tx.systx.txtype === 'assetsend') {
                  //this is tricky because some outputs are synthetic change and not allocations
                  if(vindex === length-1) { //change back to asset owner
                    asset_balances[asset_guid] = new BigNumber(asset_balances[asset_guid]).plus(amount).toFixed();
                    delta = delta.plus(amount);
                  }else{ //allocation
                    asset_allocation_balances[asset_guid] = new BigNumber(asset_allocation_balances[asset_guid]).plus(amount).toFixed();
                    delta = delta.plus(amount);
                  }
                }
              }
              break;
          }

          if (unique == true) {
            tx_array.push({addresses: txid, type: type});
            if ( tx_array.length > settings.txcount ) {
              tx_array.shift();
            }
            Address.update({a_id:hash}, {
              txs: tx_array,
              received: received.toFixed(),
              sent: sent.toFixed(),
              balance: received.minus(sent).toFixed(),
              asset_balances: asset_balances,
              asset_allocation_balances: asset_allocation_balances
            }, function() {
              //return cb();
              return saveAssetInfo(tx, asset_guid, hash, cb);
            });
          } else {
            if (type == tx_array[index].type) {
              return cb(); //duplicate
            } else {
              Address.update({a_id:hash}, {
                txs: tx_array,
                received: received.toFixed(),
                sent: sent.toFixed(),
                balance: received.minus(sent).toFixed(),
                asset_balances: asset_balances,
                asset_allocation_balances: asset_allocation_balances
              }, function() {
                return saveAssetInfo(tx, asset_guid, hash, cb);
                //return cb();
              });
            }
          }

          // let updatedAddress = await Address.findOne({ a_id: address.a_id});
          if(asset_guid != null) {
            console.log(`AFTER UPDATE ${hash}: Balances for ${asset_guid}: unallocated: ${asset_balances[asset_guid]} | allocated: ${asset_allocation_balances[asset_guid]}`);
          }

          // SAVE EXISTING ADDRESS HISTORY
          if(asset_guid !== null) {
            utils.saveAddressHistory(hash, txid, startBalance.toFixed(), asset_allocation_balances[asset_guid] ? asset_allocation_balances[asset_guid] : 0, delta.toFixed(), asset_guid, blockheight, tx.time);
          }else{
            utils.saveAddressHistory(hash, txid, startBalance.dividedBy(100000000).toFixed(), received.minus(sent).dividedBy(100000000).toFixed(), delta.dividedBy(100000000).toFixed(), "SYS", blockheight, tx.time);
          }
        });
      }
    } else {
      //new address
      let newAddressAssetBalances = {}, newAddressAssetAllocationBalances = {};
      if(tx.systx) {
        console.log("NEW ADDRESS LOGIC!");
        if (tx.systx.txtype === 'assetactivate' || tx.systx.txtype === 'assettransfer') {
          newAddressAssetBalances = {[asset_guid]: amount.toFixed()};
        } else if (tx.systx.txtype === 'assetsend' ||
            tx.systx.txtype === 'assetallocationsend' ||
            tx.systx.txtype === 'syscoinburntoassetallocation' ||
            tx.systx.txtype === 'assetallocationmint' ||
            tx.systx.txtype === 'assetallocationburntoethereum') {
          newAddressAssetAllocationBalances = {[asset_guid]: amount.toFixed()};
        }
      }

      if (type === 'vin') {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vin'} ],
          sent: amount.toFixed(),
          balance: amount.toFixed(),
          asset_balances: {}
        });
      } else if (type === 'asset_vin') {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'asset_vin'} ],
          received: 0,
          balance: 0,
          asset_balances: newAddressAssetBalances,
          asset_allocation_balances: newAddressAssetAllocationBalances
        });
      } else if (type === 'asset_vout') {
        var newAddress = new Address({
          a_id: hash,
          txs: [{addresses: txid, type: 'asset_vout'}],
          received: 0,
          balance: 0,
          asset_balances: newAddressAssetBalances,
          asset_allocation_balances: newAddressAssetAllocationBalances
        });
      } else {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vout'} ],
          received: amount.toFixed(),
          balance: amount.toFixed(),
          asset_balances: {}
        });
      }

      // SAVE NEW ADDRESS HISTORY
      if(type === 'asset_vout' || type === 'asset_vin') {
        utils.saveAddressHistory(hash, txid, "0", newAddressAssetAllocationBalances[asset_guid] ? newAddressAssetAllocationBalances[asset_guid] : 0, newAddressAssetAllocationBalances[asset_guid] ? newAddressAssetAllocationBalances[asset_guid] : 0, asset_guid, blockheight, tx.time);
      }else{
        utils.saveAddressHistory(hash, txid, "0", amount.dividedBy(100000000).toFixed(), amount.dividedBy(100000000).toFixed(), "SYS", blockheight, tx.time);
      }

      newAddress.save(function(err) {
        if (err) {
          return cb(err);
        } else {
          //console.log('address saved: %s', hash);
          //console.log(newAddress);
          return saveAssetInfo(tx, asset_guid, hash, cb);
          //return cb();
        }
      });
    }
  });
}

function saveAssetInfo(tx, asset_guid, hash, cb) {
  if(tx.txtype === 'assetactivate' && asset_guid !== null) {
    console.log("ASSIGN OWNER:", hash, " TO ", asset_guid, " at block ", tx.blockhash);
    let assetActivate = new Asset({
      asset_id: asset_guid,
      owner_address: hash,
      owner_alias: tx.owner,
      last_update_height: tx.height
    });

    assetActivate.save(err => {
      return cb();
    });
  }else{
    return cb();
  }
}

function find_tx(txid, cb) {
  Tx.findOne({txid: txid}, function(err, tx) {
    if(tx) {
      return cb(tx);
    } else {
      return cb(null);
    }
  });
}

function save_tx(txid, blockhash, blockheight, cb) {
  var s_timer = new Date().getTime();
  lib.get_rawtransaction(txid, blockhash, function(tx){
    if (tx != 'There was an error. Check your console.') {
      lib.prepare_vin(tx, function (vin) {
        lib.prepare_vout(tx.vout, txid, vin, tx.hex, async function (vout, nvin) {
          let assetInOut = await syscoinHelper.prepareAssetVinVout(tx);

          // deal with assetsend/allocationsend possibly having duplicate allocations
          // NOTE: assetsend logic assumes that there will be a change output at allocations[allocations.length-1] so preserve that!
          let assetInOutUnique = { vin: [], vout: []};
          Object.keys(assetInOutUnique).forEach(key => {
            assetInOut[key].forEach((entry, index) => {
              if(key === 'vout' && index === assetInOut['vout'].length - 1 && entry.address === tx.systx.sender) {
                assetInOutUnique[key].push(entry);
                return;
              }

              const uniqueEntry = assetInOutUnique[key].find(item => item.address === entry.address);
              if (uniqueEntry) {
                uniqueEntry.amount = new BigNumber(uniqueEntry.amount).plus(new BigNumber(entry.amount)).toFixed();
              } else {
                assetInOutUnique[key].push(entry);
              }
            });
          });

          let asset_vin = assetInOutUnique.vin;
          let asset_vout = assetInOutUnique.vout;
          let txtype = "send",
            asset_guid,
            asset_total_vout_not_change = new BigNumber(0),
            asset_totalout = 0,
            asset_symbol = '',
            asset_publicvalue;
          let assetTxInfo = tx.systx && tx.systx.asset_guid ? tx.systx : undefined;

          if (assetTxInfo) {
            //TODO: we need publicvalue
            let assetInfo = await syscoinHelper.getAssetInfo(assetTxInfo.asset_guid);

            txtype = assetTxInfo.txtype;
            asset_guid = assetTxInfo.asset_guid;
            asset_publicvalue = assetInfo.public_value;
            asset_symbol = assetInfo.symbol;

            asset_totalout = asset_vout.reduce((acc, curr, index, arr) => new BigNumber(acc).plus(new BigNumber(curr.amount)), 0);
            console.log("ASSET TX:", txid, " TXTYPE", txtype);
            //console.log("asset vin/vout: ", assetInOut);
            console.log("asset vin/vout UNIQUE: ", assetInOutUnique);

            //console.log("symbol:", asset_symbol);
            //console.log("systx:", tx.systx);
            //console.log("assetinfo:", assetInfo);

            //write asset history every time
            let assethist = new AssetHistory({
              asset_id: asset_guid,
              symbol: assetInfo.symbol,
              sender_address: asset_vin.length ? asset_vin[0].address : null,
              sender_alias: assetTxInfo.address,
              txtxype: txtype,
              vin: asset_vin,
              vout: asset_vout,
              txdata: tx.systx,
              height: blockheight,
              txid: tx.txid
            });
            await assethist.save();

            tx.txtype = txtype;
            tx.owner = tx.systx.sender;

            //detect asset doublespends and reject them
            if(asset_vin.length && asset_vout.length) {
              for(let i = 0; i < asset_vout.length - 1; i++) {
                asset_total_vout_not_change.plus(new BigNumber(asset_vout[i].amount));
              }

              console.log("asset total out not change: ", asset_total_vout_not_change.toNumber());

              if(asset_total_vout_not_change.isGreaterThan(new BigNumber(asset_vin[0].amount))) {
                let msg = `DOUBLE SPEND! ${tx.txid} ASSET ${asset_guid} because ${asset_total_vout_not_change.toFixed()} > ${asset_vin[0].amount}`;
                console.log(`   ${msg}`);
                utils.errorAndExit();
                return cb();
              }
            }
          }

          lib.syncLoop(vin.length, function (tx_vin_loop) {
            var i = tx_vin_loop.iteration();
            update_address(nvin[i].addresses, txid, nvin[i].amount, 'vin', null, i, nvin.length, tx, blockheight, function () {
              tx_vin_loop.next();
            });
          }, function () {
            lib.syncLoop(vout.length, function (tx_vout_loop) {
              var t = tx_vout_loop.iteration();
              if (vout[t].addresses) {
                update_address(vout[t].addresses, txid, vout[t].amount, 'vout', null, t, vout.length, tx, blockheight, function () {
                  tx_vout_loop.next();
                });
              } else {
                tx_vout_loop.next();
              }
            }, function () {
              lib.syncLoop(asset_vin.length, function (asset_vin_loop) {
                var u = asset_vin_loop.iteration();
                if (asset_vin[u].address) {
                  update_address(asset_vin[u].address, txid, asset_vin[u].amount, 'asset_vin', asset_guid, u, asset_vin.length, tx, blockheight, function () {
                    asset_vin_loop.next();
                  });
                } else {
                  asset_vin_loop.next();
                }
              }, function () {
                lib.syncLoop(asset_vout.length, function (asset_vout_loop) {
                  var v = asset_vout_loop.iteration();
                  if (asset_vout[v].address) {
                    update_address(asset_vout[v].address, txid, asset_vout[v].amount, 'asset_vout', asset_guid, v, asset_vout.length, tx, blockheight, function () {
                      asset_vout_loop.next();
                    });
                  } else {
                    asset_vout_loop.next();
                  }
                }, function () {
                  lib.calculate_total(vout, function (total) {
                    //determine contract address for burns, if present
                    let contract;
                    if (tx.systx) {
                      for (let m = 0; m < asset_vout.length; m++) {
                        if(asset_vout[m].address == 'burn') {
                          if(tx.systx && tx.systx.ethereum_destination)
                            contract = tx.systx.ethereum_destination;
                        }
                      }
                    } else {
                      for (let m = 0; m < vout.length; m++) {
                        if(vout[m].opreturn) {
                          txtype = 'syscoinburntoassetallocation';
                          if(vout[m].opreturn.length > 9)
                            contract = vout[m].opreturn.substring(10);
                        }
                      }
                    }

                    var newTx = new Tx({
                      txid: tx.txid,
                      vin: nvin,
                      asset_vin: asset_vin,
                      asset_vout: asset_vout,
                      asset_guid: asset_guid,
                      asset_publicvalue: asset_publicvalue,
                      asset_symbol: asset_symbol,
                      asset_total: txtype == 'assetactivate' || txtype == 'assetupdate' ? new BigNumber(asset_totalout).toFixed() : new BigNumber(asset_total_vout_not_change).toFixed(),
                      vout: vout,
                      total: new BigNumber(total).toFixed(),
                      timestamp: tx.time,
                      blockhash: blockhash,
                      blockindex: blockheight,
                      contract: contract,
                      txtype: txtype
                    });

                    // console.log('prewrite:', new Date().getTime() - s_timer);
                    newTx.save(function (err) {
                      if (err) {
                        return cb(err);
                      } else {
                        console.log('tx write took total:', new Date().getTime() - s_timer);
                        return cb();
                      }
                    });
                  });
                });
              });
            });
          });
        });
      });
    } else {
      return cb('tx not found: ' + txid + ', block:' + blockhash + ', height: ' + blockheight);
    }
  });
}

function get_market_data(market, cb) {
  switch(market) {
    case 'bittrex':
      bittrex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'bleutrade':
      bleutrade.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'poloniex':
      poloniex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptsy':
      cryptsy.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptsy_id, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptopia':
      cryptopia.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptopia_id, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'ccex':
      ccex.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), settings.markets.ccex_key, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'yobit':
      yobit.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'empoex':
      empoex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    default:
      return cb(null);
  }
}

module.exports = {
  // initialize DB
  connect: function(database, cb) {
    mongoose.connect(database, function(err) {
      if (err) {
        console.log('Unable to connect to database: %s', database);
        console.log('Aborting');
        process.exit(1);

      }
      //console.log('Successfully connected to MongoDB');
      return cb();
    });
  },

  check_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(stats);
      } else {
        return cb(null);
      }
    });
  },

  create_stats: function(coin, cb) {
    var newStats = new Stats({
      coin: coin,
    });

    newStats.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial stats entry created for %s", coin);
        //console.log(newStats);
        return cb();
      }
    });
  },

  get_address: function(hash, cb) {
    find_address(hash, function(address){
      return cb(address);
    });
  },

  get_richlist: function(coin, cb) {
    find_richlist(coin, function(richlist){
      return cb(richlist);
    });
  },
  //property: 'received' or 'balance'
  update_richlist: function(list, cb){
    if(list == 'received') {
      Address.find({}).sort({received: 'desc'}).limit(100).exec(function(err, addresses){
        Richlist.update({coin: settings.coin}, {
          received: addresses,
        }, function() {
          return cb();
        });
      });
    } else { //balance
      Address.find({}).sort({balance: 'desc'}).limit(100).exec(function(err, addresses){
        Richlist.update({coin: settings.coin}, {
          balance: addresses,
        }, function() {
          return cb();
        });
      });
    }
  },

  get_tx: function(txid, cb) {
    find_tx(txid, function(tx){
      return cb(tx);
    });
  },

  get_txs: function(block, cb) {
    var txs = [];
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      find_tx(block.tx[i], function(tx){
        if (tx) {
          txs.push(tx);
          loop.next();
        } else {
          loop.next();
        }
      })
    }, function(){
      return cb(txs);
    });
  },

  create_txs: function(block, blockhash, cb) {
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      save_tx(block.tx[i], blockhash, block.height, function(err){
        if (err) {
          loop.next();
        } else {
          //console.log('tx stored: %s', block.tx[i]);
          loop.next();
        }
      });
    }, function(){
      return cb();
    });
  },

  get_last_txs: function(count, min, cb) {
    Tx.find({'total': {$gt: min}}).sort({_id: 'desc'}).limit(count).exec(function(err, txs){
      if (err) {
        return cb(err);
      } else {
        return cb(txs);
      }
    });
  },

  create_market: function(coin, exchange, market, cb) {
    var newMarkets = new Markets({
      market: market,
      coin: coin,
      exchange: exchange,
    });

    newMarkets.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial markets entry created for %s", market);
        //console.log(newMarkets);
        return cb();
      }
    });
  },

  // checks market data exists for given market
  check_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, exists) {
      if(exists) {
        return cb(market, true);
      } else {
        return cb(market, false);
      }
    });
  },

  // gets market data for given market
  get_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, data) {
      if(data) {
        return cb(data);
      } else {
        return cb(null);
      }
    });
  },

  // creates initial richlist entry in database; called on first launch of explorer
  create_richlist: function(coin, cb) {
    var newRichlist = new Richlist({
      coin: coin,
    });
    newRichlist.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial richlist entry created for %s", coin);
        //console.log(newRichlist);
        return cb();
      }
    });
  },
  // checks richlist data exists for given coin
  check_richlist: function(coin, cb) {
    Richlist.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  create_heavy: function(coin, cb) {
    var newHeavy = new Heavy({
      coin: coin,
    });
    newHeavy.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial heavy entry created for %s", coin);
        console.log(newHeavy);
        return cb();
      }
    });
  },

  check_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, heavy) {
      if(heavy) {
        return cb(heavy);
      } else {
        return cb(null);
      }
    });
  },
  get_distribution: function(richlist, stats, cb){
    var distribution = {
      supply: stats.supply,
      t_1_25: {percent: 0, total: 0 },
      t_26_50: {percent: 0, total: 0 },
      t_51_75: {percent: 0, total: 0 },
      t_76_100: {percent: 0, total: 0 },
      t_101plus: {percent: 0, total: 0 }
    };
    lib.syncLoop(richlist.balance.length, function (loop) {
      var i = loop.iteration();
      var count = i + 1;
      var percentage = ((richlist.balance[i].balance / 100000000) / stats.supply) * 100;
      if (count <= 25 ) {
        distribution.t_1_25.percent = distribution.t_1_25.percent + percentage;
        distribution.t_1_25.total = distribution.t_1_25.total + (richlist.balance[i].balance / 100000000);
      }
      if (count <= 50 && count > 25) {
        distribution.t_26_50.percent = distribution.t_26_50.percent + percentage;
        distribution.t_26_50.total = distribution.t_26_50.total + (richlist.balance[i].balance / 100000000);
      }
      if (count <= 75 && count > 50) {
        distribution.t_51_75.percent = distribution.t_51_75.percent + percentage;
        distribution.t_51_75.total = distribution.t_51_75.total + (richlist.balance[i].balance / 100000000);
      }
      if (count <= 100 && count > 75) {
        distribution.t_76_100.percent = distribution.t_76_100.percent + percentage;
        distribution.t_76_100.total = distribution.t_76_100.total + (richlist.balance[i].balance / 100000000);
      }
      loop.next();
    }, function(){
      distribution.t_101plus.percent = parseFloat(100 - distribution.t_76_100.percent - distribution.t_51_75.percent - distribution.t_26_50.percent - distribution.t_1_25.percent).toFixed(2);
      distribution.t_101plus.total = parseFloat(distribution.supply - distribution.t_76_100.total - distribution.t_51_75.total - distribution.t_26_50.total - distribution.t_1_25.total).toFixed(8);
      distribution.t_1_25.percent = parseFloat(distribution.t_1_25.percent).toFixed(2);
      distribution.t_1_25.total = parseFloat(distribution.t_1_25.total).toFixed(8);
      distribution.t_26_50.percent = parseFloat(distribution.t_26_50.percent).toFixed(2);
      distribution.t_26_50.total = parseFloat(distribution.t_26_50.total).toFixed(8);
      distribution.t_51_75.percent = parseFloat(distribution.t_51_75.percent).toFixed(2);
      distribution.t_51_75.total = parseFloat(distribution.t_51_75.total).toFixed(8);
      distribution.t_76_100.percent = parseFloat(distribution.t_76_100.percent).toFixed(2);
      distribution.t_76_100.total = parseFloat(distribution.t_76_100.total).toFixed(8);
      return cb(distribution);
    });
  },
  // updates heavy stats for coin
  // height: current block height, count: amount of votes to store
  update_heavy: function(coin, height, count, cb) {
    var newVotes = [];
    lib.get_maxmoney( function (maxmoney) {
      lib.get_maxvote( function (maxvote) {
        lib.get_vote( function (vote) {
          lib.get_phase( function (phase) {
            lib.get_reward( function (reward) {
              lib.get_supply( function (supply) {
                lib.get_estnext( function (estnext) {
                  lib.get_nextin( function (nextin) {
                    lib.syncLoop(count, function (loop) {
                      var i = loop.iteration();
                      lib.get_blockhash(height-i, function (hash) {
                        lib.get_block(hash, function (block) {
                          newVotes.push({count:height-i,reward:block.reward,vote:block.vote});
                          loop.next();
                        });
                      });
                    }, function(){
                      console.log(newVotes);
                      Heavy.update({coin: coin}, {
                        lvote: vote,
                        reward: reward,
                        supply: supply,
                        cap: maxmoney,
                        estnext: estnext,
                        phase: phase,
                        maxvote: maxvote,
                        nextin: nextin,
                        votes: newVotes,
                      }, function() {
                        //console.log('address updated: %s', hash);
                        return cb();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  },

  // updates market data for given market; called by sync.js
  update_markets_db: function(market, cb) {
    get_market_data(market, function (err, obj) {
      if (err == null) {
        Markets.update({market:market}, {
          chartdata: JSON.stringify(obj.chartdata),
          buys: obj.buys,
          sells: obj.sells,
          history: obj.trades,
          summary: obj.stats,
        }, function() {
          if ( market == settings.markets.default ) {
            Stats.update({coin:settings.coin}, {
              last_price: obj.stats.last,
            }, function(){
              return cb(null);
            });
          } else {
            return cb(null);
          }
        });
      } else {
        return cb(err);
      }
    });
  },

  // updates stats data for given coin; called by sync.js
  update_db: function(coin, cb) {
    lib.get_blockcount( function (count) {
      if (!count){
        console.log('Unable to connect to explorer API');
        return cb(false);
      }
      lib.get_supply( function (supply){
        lib.get_connectioncount(function (connections) {
          Stats.update({coin: coin}, {
            coin: coin,
            count : count,
            supply: supply,
            connections: connections,
          }, function() {
            return cb(true);
          });
        });
      });
    });
  },

  // updates tx, address & richlist db's; called by sync.js
  update_tx_db: function(coin, start, end, timeout, cb) {
    var complete = false;
    lib.syncLoop((end - start) + 1, function (loop) {
      var x = loop.iteration();
      if (x % 5000 === 0) {
        Tx.find({}).where('blockindex').lt(start + x).sort({timestamp: 'desc'}).limit(settings.index.last_txs).exec(function(err, txs){
          Stats.update({coin: coin}, {
            last: start + x - 1,
            last_txs: '' //not used anymore left to clear out existing objects
          }, function() {
            console.log("stats update");
          });
        });
      }

      lib.get_blockhash(start + x, function(blockhash){
        if (blockhash) {
          lib.get_block(blockhash, function(block) {
            if (block) {
              lib.syncLoop(block.tx.length, function (subloop) {
                var i = subloop.iteration();
                Tx.findOne({txid: block.tx[i]}, function(err, tx) {
                  if(tx && start === 1) {
                    tx = null;
                    subloop.next();
                  } else {
                    save_tx(block.tx[i], blockhash, block.height, function(err){
                      if (err) {
                        console.log(err);
                      } else {
                        console.log('%s: %s', block.height, block.tx[i]);
                      }
                      setTimeout( function(){
                        tx = null;
                        subloop.next();
                      }, timeout);
                    });
                  }
                });
              }, function(){
                blockhash = null;
                block = null;
                loop.next();
              });
            } else {
              console.log('block not found: %s', blockhash);
              loop.next();
            }
          });
        } else {
          loop.next();
        }
      });
    }, function(){
      Tx.find({}).sort({timestamp: 'desc'}).limit(settings.index.last_txs).exec(function(err, txs){
        Stats.update({coin: coin}, {
          last: end,
          last_txs: '' //not used anymore left to clear out existing objects
        }, function() {
          return cb();
        });
      });
    });
  },

  create_peer: function(params, cb) {
    var newPeer = new Peers(params);
    newPeer.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_peer: function(address, cb) {
    Peers.findOne({address: address}, function(err, peer) {
      if (err) {
        return cb(null);
      } else {
        if (peer) {
         return cb(peer);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_peers: function(cb) {
    Peers.find({}, function(err, peers) {
      if (err) {
        return cb([]);
      } else {
        return cb(peers);
      }
    });
  }
};
