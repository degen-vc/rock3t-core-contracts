const BN = require("bn.js");

const timeMachine = require('ganache-time-traveler');

module.exports = {
  timeTravelTo,
  timeTravelToDate,
  timeTravelToBlock,
  takeSnapshot,
  revertToSnapshot,
  expandTo18Decimals
}

/**
 * @function Move chain to current block time
 * @param time number(timestamp)
 * @returns {Promise<*>}
 */
async function timeTravelTo(time=0) {
  return timeMachine.advanceTimeAndBlock(time);
}

/**
 *
 * @param time
 * @returns {Promise<*>}
 */
async function timeTravelToDate(time) {
  return timeMachine.advanceTime(time);
}

/**
 *
 * @param block
 * @returns {Promise<*>}
 */
async function timeTravelToBlock(block) {
  return timeMachine.advanceBlock(block);
}

/**
 * @function Create EVM snapshot
 * @returns {Promise<*>}
 */
async function takeSnapshot() {
  let snapshot = await timeMachine.takeSnapshot();
  return snapshot['result'];
}

/**
 * @function Revert to snapshot id
 * @param id of snapshot
 * @returns {Promise<*>}
 */
async function revertToSnapshot(id) {
  return timeMachine.revertToSnapshot(id);
}

/**
 *
 * @param n number
 * @returns {BN}
 */
function expandTo18Decimals(n) {
  return new BN(n).mul(new BN(10).pow(new BN(18)));
}