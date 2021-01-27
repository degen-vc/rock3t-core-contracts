const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const RocketToken = artifacts.require('RocketToken');
const FeeApprover = artifacts.require('FeeApprover');

contract('rocket token', accounts => {
  const ganache = new Ganache(web3);
  const [ owner, feeDestination, notOwner, liquidVault, uniswapPair] = accounts;
  const { ZERO_ADDRESS } = constants;

  afterEach('revert', ganache.revert);

  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  let uniswapFactory;
  let uniswapRouter;

  let rocketToken;
  let feeApprover;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;

    feeApprover = await FeeApprover.new();
    rocketToken = await RocketToken.new(feeDestination, feeApprover.address, uniswapRouter.address, uniswapFactory.address);

    await feeApprover.initialize(uniswapPair, liquidVault);
    await feeApprover.unPause();

    await ganache.snapshot();
  });

  it('should create a uniswap pair', async () => {
      const pairAddressBefore = await rocketToken.tokenUniswapPair.call();
      assert.equal(pairAddressBefore, ZERO_ADDRESS);

      const createPair = await rocketToken.createUniswapPair();
      expectEvent.inTransaction(createPair.tx, uniswapFactory, 'PairCreated');
      
  });
  
  it('should create a uniswap pair only once', async () => {
      await rocketToken.createUniswapPair();

      await expectRevert(
          rocketToken.createUniswapPair(),
          'Token: pool already created'
      );
  });

  it('should revert if pair creator is not an owner', async () => {
      await expectRevert(
          rocketToken.createUniswapPair({ from: notOwner }),
          'Ownable: caller is not the owner'
      );
  });

  it('should not configure the fee distributor for non-owner', async () => {
      await expectRevert(
          rocketToken.setFeeDistributor(feeDestination, { from: notOwner }),
          'Ownable: caller is not the owner'
      );
  });

  it('should set the fee to 5 pecentage by an owner', async () => {
      const expectedFee = 50; //50%
      await feeApprover.setFeeMultiplier(expectedFee);
      assertBNequal(await feeApprover.feePercentX100.call(), expectedFee);
  });

  it('should check totalSupply to be equal 11 000 000', async () => {
      const totalSupply = await rocketToken.totalSupply.call();
      const expectedSupply = web3.utils.toWei('11000000');
      
      assertBNequal(totalSupply, expectedSupply);
  });

  it('should collect fee while transfer and send it to the destination address', async () => {
      const feeDestinationBefore = await rocketToken.balanceOf(feeDestination);
      const amountToSend = 10000;
      const fee = await feeApprover.feePercentX100.call();

      await rocketToken.transfer(notOwner, amountToSend);
      
      const feeDestinationAfter = await rocketToken.balanceOf(feeDestination);
      const expectdFeeAmount = (fee * amountToSend) / 100;
      const recepientBalance = await rocketToken.balanceOf(notOwner);
      const expectedBalance = amountToSend - expectdFeeAmount;
      
      assertBNequal(feeDestinationBefore, 0);
      assertBNequal(feeDestinationAfter, expectdFeeAmount);
      assertBNequal(recepientBalance, expectedBalance);
  });
});