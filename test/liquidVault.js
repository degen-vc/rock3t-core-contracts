const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const truffleAssert = require('truffle-assertions');

const FeeApprover = artifacts.require('FeeApprover');
const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');

contract('liquid vault', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  const primary = accounts[0];

  const nftFund = accounts[9];

  let uniswapFactory;
  let uniswapRouter;
  let weth;

  let feeApprover;
  let feeDistributor;
  let rocketToken;
  let liquidVault;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    // deploy and setup main contracts
    feeApprover = await FeeApprover.new();
    feeDistributor = await FeeDistributor.new();
    rocketToken = await RocketToken.new();
    liquidVault = await LiquidVault.new();

    await rocketToken.initialSetup(
      uniswapRouter.address,
      uniswapFactory.address,
      feeApprover.address,
      feeDistributor.address,
      liquidVault.address
    );


    await feeDistributor.seed(rocketToken.address, liquidVault.address, nftFund, 40, 1);
    await feeApprover.initialize(rocketToken.address, uniswapFactory.address, uniswapRouter.address, liquidVault.address);
    await liquidVault.seed(2, rocketToken.address, feeDistributor.address, nftFund, 10, 10);

    await feeApprover.unPause();
    await rocketToken.transfer(feeDistributor.address, "25000000000")

    await ganache.snapshot();
  });

  it.only('should fail on purchaseLP with no eth', async () => {
    await truffleAssert.reverts(
      liquidVault.purchaseLP({ value: '0' }),
      'LiquidVault: eth required to mint tokens LP',
    );
  })

});
