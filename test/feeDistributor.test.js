const Ganache = require('./helpers/ganache');
const { expectEvent, expectRevert, constants } = require("@openzeppelin/test-helpers");
const deployUniswap = require('./helpers/deployUniswap');
const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const FeeApprover = artifacts.require('FeeApprover');

contract('fee distributor', accounts => {
  const ganache = new Ganache(web3);
  const [ owner, liquidVault, secondary ] = accounts;

  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  let feeDistributor;
  let feeApprover;
  let rocketToken;
  let uniswapPair;
  let uniswapFactory;
  let uniswapRouter;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;

    feeApprover = await FeeApprover.new();
    feeDistributor = await FeeDistributor.new();
    rocketToken = await RocketToken.new(feeDistributor.address, feeApprover.address, uniswapRouter.address, uniswapFactory.address);
    await rocketToken.createUniswapPair();
    uniswapPair = await rocketToken.tokenUniswapPair();

    await feeApprover.initialize(uniswapPair, liquidVault);
    await feeApprover.unPause();
    await feeApprover.setFeeMultiplier(0);

    await ganache.snapshot();
  });

  it('should fail to distribute fees without seed() function', async () => {
    const amount = 100000;

    await rocketToken.transfer(feeDistributor.address, amount);
    await expectRevert(
      feeDistributor.distributeFees(),
      'R3T: Fees cannot be distributed until Distributor seeded.'
    );
  });

  it('should check all the public variables', async () => {
    const secondaryAddressShare = 10;

    await feeDistributor.seed(rocketToken.address, liquidVault, secondary, secondaryAddressShare);

    assert.equal(rocketToken.address, await feeDistributor.R3Ttoken.call());
    assert.equal(liquidVault, await feeDistributor.liquidVault.call());
    assert.equal(secondary, await feeDistributor.secondaryAddress.call());
    assert.equal(secondaryAddressShare, await feeDistributor.secondaryAddressShare.call());
    assert.equal(true, await feeDistributor.initialized.call());
  });

  it('should distribute and properly calculate fees', async () => {
      const amount = 100000;
      const secondaryAddressShare = 10;

      await feeDistributor.seed(rocketToken.address, liquidVault, secondary, secondaryAddressShare);
      await rocketToken.transfer(feeDistributor.address, amount);

      const feeDistBalance = await rocketToken.balanceOf(feeDistributor.address);
      
      const expectedSecondaryBalance = bn(secondaryAddressShare).mul(bn(feeDistBalance)).div(bn('100'));
      await feeDistributor.distributeFees();
      const lvBalance = await rocketToken.balanceOf(liquidVault);
      const secondaryBalance = await rocketToken.balanceOf(secondary);

      assertBNequal(bn(feeDistBalance).sub(expectedSecondaryBalance), lvBalance);
      assertBNequal(expectedSecondaryBalance, secondaryBalance);
      
      
  });
});