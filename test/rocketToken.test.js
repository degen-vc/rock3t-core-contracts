const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const FeeApprover = artifacts.require("FeeApprover");

contract('rocket token', accounts => {
  const ganache = new Ganache(web3);
  const [ owner, feeDestination, notOwner, liquidVault ] = accounts;
  const { ZERO_ADDRESS } = constants;

  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

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

    feeApprover = await FeeApprover.new();
    rocketToken = await RocketToken.new(feeDestination, feeApprover.address, uniswapRouter.address, uniswapFactory.address);

    await feeApprover.initialize(rocketToken.address, uniswapFactory.address, uniswapRouter.address, liquidVault, { from: owner });
    await feeApprover.unPause({ from: owner });

    await ganache.snapshot();
  });
  
  it('should create a uniswap pair only once', async () => {
      await expectRevert(
          rocketToken.createUniswapPair(),
          'Token: pool already created'
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
      await feeApprover.setFeeMultiplier(expectedFee, { from: owner });
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
      console.log('fee', fee.toString());
      

      const tr = await rocketToken.transfer(notOwner, amountToSend);
      console.log('transfer', JSON.stringify(tr));
      

      const feeDestinationAfter = await rocketToken.balanceOf(feeDestination);
      console.log('fee destination balance', feeDestinationAfter.toString());
      
      const expectdFeeAmount = (fee * amountToSend) / 100;
      const recepientBalance = await rocketToken.balanceOf(notOwner);
      console.log('recipient balance', feeDestinationAfter.toString());
      const expectedBalance = amountToSend - expectdFeeAmount;
      
      assertBNequal(feeDestinationBefore, 0);
      assertBNequal(feeDestinationAfter, expectdFeeAmount);
      assertBNequal(recepientBalance, expectedBalance);
  });
});