const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');

contract('rocket token', accounts => {
  const ganache = new Ganache(web3);
  const [ owner, feeDestination, notOwner ] = accounts;
  const { ZERO_ADDRESS } = constants;
  const rocketFee = 100; //10%

  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let rocketToken;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    rocketToken = await RocketToken.new(rocketFee, feeDestination, uniswapRouter.address, uniswapFactory.address);

    await ganache.snapshot();
  });
  
  it('should create a uniswap pair only once', async () => {
      await expectRevert(
          rocketToken.createUniswapPair(),
          'Token: pool already created'
      );
  });

  it('should not configure the fee for non-owner', async () => {
      await expectRevert(
          rocketToken.configureFee(rocketFee, feeDestination, { from: notOwner }),
          'Ownable: caller is not the owner'
      );
  });

  it('should set the fee to 5 pecentage by an owner', async () => {
      const expectedFee = 50; //5%
      await rocketToken.configureFee(expectedFee, feeDestination, { from: owner });

      assertBNequal(await rocketToken.fee(), expectedFee);
  });

  it('should collect fee while transfer and send it to the destination address', async () => {
      const feeDestinationBefore = await rocketToken.balanceOf(feeDestination);
      const amountToSend = 10000;
      const fee = await rocketToken.fee();

      await rocketToken.transfer(notOwner, amountToSend);

      const feeDestinationAfter = await rocketToken.balanceOf(feeDestination);
      const expectdFeeAmount = (fee * amountToSend) / 1000;
      const recepientBalance = await rocketToken.balanceOf(notOwner);
      const expectedBalance = amountToSend - expectdFeeAmount;
      
      assertBNequal(fee, rocketFee);
      assertBNequal(feeDestinationBefore, 0);
      assertBNequal(feeDestinationAfter, expectdFeeAmount);
      assertBNequal(recepientBalance, expectedBalance);
  });
});