
const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');


contract('liquid vault', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const NOT_OWNER = accounts[1];
  const nftFund = accounts[9];
  const baseUnit = bn('1000000000000000000');

  const ethFee = 0 // 1%;
  const blackHoleFee = 10 // 1%;
  const lvEthFeePercent = 10 // 1%;
  const feeReceiver = accounts[8];
  const treasury = accounts[7];

  //TODO get UniswapPair
  const uniswapPair = accounts[3];

  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let feeDistributor;
  let rocketToken;
  let liquidVault;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    // deploy and setup main contracts
    feeDistributor = await FeeDistributor.new();
    rocketToken = await RocketToken.new(ethFee, feeReceiver, uniswapRouter.address, uniswapFactory.address);
    liquidVault = await LiquidVault.new();


    await feeDistributor.seed(rocketToken.address, liquidVault.address);
  
    await liquidVault.seed(
      rocketToken.address,
      feeDistributor.address,
      blackHoleFee,
      uniswapRouter.address,
      uniswapPair,
      lvEthFeePercent,
      treasury
    );

    await ganache.snapshot();
  });

  describe('General tests', async () => {
    it('should set all values after LV setup', async () => {
      const config = await liquidVault.config();

      assert.equal(config.R3T, rocketToken.address);
      assert.equal(config.feeDistributor, feeDistributor.address);
      assert.equal(config.tokenPair, uniswapPair);
      assert.equal(config.uniswapRouter, uniswapRouter.address);
      assert.equal(config.weth, weth.address);
      assert.equal(config.self, liquidVault.address);
      assert.equal(config.blackHoleShare, blackHoleFee);
      assert.equal(treasury, treasury);
      assertBNequal(config.ethFeePercentage, lvEthFeePercent);
    });

    it('should set initial formula constants after deploy', async () => {
      const constants = await liquidVault.CONSTANTS();

      assertBNequal(constants.scalingWet, '11344');
      assertBNequal(constants.shiftWet, '-3');
      assertBNequal(constants.scalingDry, '-191');
      assertBNequal(constants.shiftDry, '-217');
      assertBNequal(constants.minLockTime, '1');
    });

    it('should be possible to update formula constants for owner', async () => {

      await liquidVault.setLockTimeConstants(1, 2, 3, 4, 5);

      const constants = await liquidVault.CONSTANTS();

      assertBNequal(constants.scalingWet, 1);
      assertBNequal(constants.shiftWet, 2);
      assertBNequal(constants.scalingDry, 3);
      assertBNequal(constants.shiftDry, 4);
      assertBNequal(constants.minLockTime, 5);
    });

    it('should NOT be possible to update formula constants for NOT owner', async () => {
      await expectRevert(
        liquidVault.setLockTimeConstants(1, 2, 3, 4, 5, {from: NOT_OWNER}),
        'Ownable: caller is not the owner',
      );

      const constants = await liquidVault.CONSTANTS();
      assertBNequal(constants.scalingWet, '11344');
    });

    it('should be possible to flush to treasury from owner', async () => {
      const amount = 10000;
      await rocketToken.transfer(liquidVault.address, amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);

      await liquidVault.flushToTreasury(amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), 0);
      assertBNequal(await rocketToken.balanceOf(treasury), amount);
    });

    it('should NOT possible to flush to treasury from NOT owner', async () => {
      const amount = 10000;
      await rocketToken.transfer(liquidVault.address, amount);

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);

      await expectRevert(
        liquidVault.flushToTreasury(amount, {from: NOT_OWNER}),
        'Ownable: caller is not the owner',
      );

      assertBNequal(await rocketToken.balanceOf(liquidVault.address), amount);
      assertBNequal(await rocketToken.balanceOf(treasury), 0);
    });

    it('it should NOT be possible to add pair 2nd time', async () => {
      await expectRevert(
        rocketToken.createUniswapPair(),
        'Token: pool already created',
      );
    });

    it.only('should be possible to add liquidity on pair', async () => {
      const liquidityTokensAmount = bn('10000').mul(baseUnit); // 10.000 tokens
      const liquidityEtherAmount = bn('5').mul(baseUnit); // 5 ETH

      const pairAddress = await rocketToken.tokenUniswapPair();
      const pair = await IUniswapV2Pair.at(pairAddress);

      const reservesBefore = await pair.getReserves();
      assertBNequal(reservesBefore[0], 0);
      assertBNequal(reservesBefore[1], 0);
      
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

      const reservesAfter = await pair.getReserves();

      if (await pair.token0() == rocketToken.address) {
        assertBNequal(reservesAfter[0], liquidityTokensAmount);
        assertBNequal(reservesAfter[1], liquidityEtherAmount);
      } else {
        assertBNequal(reservesAfter[0], liquidityEtherAmount);
        assertBNequal(reservesAfter[1], liquidityTokensAmount);
      }
    });
  });

  describe('Lock period', async () => {

  });

  // function addLiquidityETH(
  //   address token,
  //   uint amountTokenDesired,
  //   uint amountTokenMin,
  //   uint amountETHMin,
  //   address to,
  //   uint deadline
  // )

  // getReserves




  // TODO
  // 0 uint ethInUniswap = address(config.tokenPair).balance; - in updatelocktime, weth.balanceOf should be
  // 1. Move updateLockTime to getter fo frontend
  // 2. Add initialSetup to rocket token with adding pair on uniswap
  // 3. Add liquidity to the rocket pair

  // it('should fail on purchaseLP with no eth', async () => {
  //   await expectRevert(
  //     liquidVault.purchaseLP({ value: '0' }),
  //     'R3T: eth required to mint R3T LP',
  //   );
  // });


  // it should calculate properly GlobalLPLockTime for aprox initial values like ethInUniswap = 5 and ethValueTokensOnLV = ?? 890000 / ethprice per token
  // other cases with ethInUniswap / ethValueTokensOnLV
  // add cases whe users starts to buy via purchaseLP and ethInUniswap in increase and ethValueTokensOnLV amount goes down, nut ethprice per token goes up

});
