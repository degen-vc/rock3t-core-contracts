const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const RocketToken = artifacts.require('RocketToken');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const PriceOracle = artifacts.require('PriceOracle');
const FeeApprover = artifacts.require('FeeApprover');

contract('uniswap oracle', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const liquidVault = accounts[1];
  const baseUnit = bn('1000000000000000000');

  const feeReceiver = accounts[8];

  let uniswapOracle;
  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let rocketToken;
  let feeApprover;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    // deploy and setup main contracts
    feeApprover = await FeeApprover.new();
    rocketToken = await RocketToken.new(feeReceiver, feeApprover.address, uniswapRouter.address, uniswapFactory.address);

    await rocketToken.createUniswapPair();
    uniswapPair = await rocketToken.tokenUniswapPair();

    uniswapOracle = await PriceOracle.new(uniswapPair, rocketToken.address, weth.address);

    await feeApprover.initialize(uniswapPair, liquidVault);
    await feeApprover.unPause();
    await feeApprover.setFeeMultiplier(0);

    const liquidityTokensAmount = bn('10').mul(baseUnit);
    const liquidityEtherAmount = bn('5').mul(baseUnit);

    await rocketToken.approve(uniswapRouter.address, liquidityTokensAmount);
    await uniswapRouter.addLiquidityETH(
      rocketToken.address,
      liquidityTokensAmount,
      0,
      0,
      OWNER,
      new Date().getTime() + 3000,
      {value: liquidityEtherAmount}
    );

    await ganache.snapshot();
  });
  describe('oracle flow', () => {
    beforeEach('adds prices', async () => {
      const pair = await IUniswapV2Pair.at(uniswapPair);
      const previousBlockTimestamp = (await pair.getReserves())[2]
      
      await uniswapOracle.update()

      const blockTimestamp = Number(previousBlockTimestamp) + 7 * 1800;
      await ganache.setTime(blockTimestamp.toString());
    });

    it('updates & consults R3T price', async () => {
      const price = await uniswapOracle.consult();
      
      assertBNequal(price, bn('500000000000000000'));
    })
  });
});