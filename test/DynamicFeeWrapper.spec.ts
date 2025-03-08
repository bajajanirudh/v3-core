import { ethers, waffle } from 'hardhat';
import { Wallet } from 'ethers';
import { expect } from './shared/expect';
import { poolFixture } from './shared/fixtures';
import snapshotGasCost from './shared/snapshotGasCost';
import {
  expandTo18Decimals,
  encodePriceSqrt,
  getMinTick,
  getMaxTick,
  TICK_SPACINGS,
  FeeAmount,
  createPoolFunctions,
  SwapFunction,
  MintFunction,
  MaxUint128,
} from './shared/utilities';
import { DynamicFeeWrapper } from '../typechain/DynamicFeeWrapper';
import { MockTimeUniswapV3Pool } from '../typechain/MockTimeUniswapV3Pool';

const createFixtureLoader = waffle.createFixtureLoader;

describe('DynamicFeeWrapper', () => {
  let wallet: Wallet, other: Wallet;
  let loadFixture: ReturnType<typeof createFixtureLoader>;
  let pool: MockTimeUniswapV3Pool;
  let wrapper: DynamicFeeWrapper;
  let swapExact0For1: SwapFunction;
  let mint: MintFunction;

  before('create fixture loader', async () => {
    [wallet, other] = await (ethers as any).getSigners();
    loadFixture = createFixtureLoader([wallet, other]);
  });

  const startingPrice = encodePriceSqrt(100001, 100000);
  const startingTick = 0;
  const feeAmount = FeeAmount.MEDIUM;
  const tickSpacing = TICK_SPACINGS[feeAmount];
  const minTick = getMinTick(tickSpacing);
  const maxTick = getMaxTick(tickSpacing);

  const gasTestFixture = async ([wallet]: Wallet[]) => {
    const fix = await poolFixture([wallet], waffle.provider);

    // Deploy the UniswapV3Pool
    const pool = await fix.createPool(feeAmount, tickSpacing);

    // Initialize the pool with a valid timestamp
    await pool.initialize(startingPrice);
    await pool.increaseObservationCardinalityNext(4);

    // Advance time by 1 second to avoid "OLD" error
    await pool.advanceTime(1);

    // Deploy the DynamicFeeWrapper
    const DynamicFeeWrapper = await ethers.getContractFactory('DynamicFeeWrapper');
    const wrapper = (await DynamicFeeWrapper.deploy(pool.address)) as unknown as DynamicFeeWrapper; // Cast to correct type
    await wrapper.deployed();

    // Create pool functions
    const { swapExact0For1, mint } = await createPoolFunctions({
      swapTarget: fix.swapTargetCallee,
      token0: fix.token0,
      token1: fix.token1,
      pool,
    });

    // Mint initial liquidity
    await mint(wallet.address, minTick, maxTick, expandTo18Decimals(2));

    return { pool, wrapper, swapExact0For1, mint };
  };

  beforeEach('load the fixture', async () => {
    ({ pool, wrapper, swapExact0For1, mint } = await loadFixture(gasTestFixture));
  });

  describe('#calculateFee', () => {
    it('should calculate fee within bounds', async () => {
      const fee = await wrapper.calculateFee(pool.address); // Pass pool address
      expect(fee).to.be.gte(500); // Minimum fee: 0.05%
      expect(fee).to.be.lte(10000); // Maximum fee: 1.00%
    });

    it('should update fee based on volume and volatility', async () => {
      // Initial fee
      const initialFee = await wrapper.calculateFee(pool.address);

      // Perform a swap to increase volume
      await swapExact0For1(expandTo18Decimals(1), wallet.address);

      // Check if fee increased
      const updatedFee = await wrapper.calculateFee(pool.address);
      expect(updatedFee).to.be.gt(initialFee);
    });

    it('should enforce minimum fee', async () => {
      // Simulate low volume and volatility
      await swapExact0For1(expandTo18Decimals(0.1), wallet.address);
      const fee = await wrapper.calculateFee(pool.address);
      expect(fee).to.equal(500); // Minimum fee: 0.05%
    });

    it('should enforce maximum fee', async () => {
      // Simulate high volume and volatility
      await swapExact0For1(expandTo18Decimals(1000), wallet.address);
      const fee = await wrapper.calculateFee(pool.address);
      expect(fee).to.equal(10000); // Maximum fee: 1.00%
    });
  });

  describe('#swapWithDynamicFee', () => {
    it('should execute swap with dynamic fee', async () => {
      const amountSpecified = expandTo18Decimals(1);
      const sqrtPriceLimitX96 = ethers.BigNumber.from('0'); // No price limit

      // Check initial fee
      const initialFee = await wrapper.calculateFee(pool.address);

      // Perform swap
      await snapshotGasCost(
        wrapper.swapWithDynamicFee(pool.address, wallet.address, true, amountSpecified, sqrtPriceLimitX96, '0x')
      );

      // Check if fee updated
      const updatedFee = await wrapper.calculateFee(pool.address);
      expect(updatedFee).to.be.gt(initialFee);
    });
  });

  describe('#addLiquidityWithDynamicFee', () => {
    it('should add liquidity with dynamic fee', async () => {
      const amount = expandTo18Decimals(1);
      const tickLower = startingTick - tickSpacing;
      const tickUpper = startingTick + tickSpacing;

      // Perform mint
      await snapshotGasCost(
        wrapper.addLiquidityWithDynamicFee(pool.address, wallet.address, tickLower, tickUpper, amount, '0x')
      );

      // Check if liquidity was added
      const liquidity = await pool.liquidity();
      expect(liquidity).to.be.gt(0);
    });
  });

  describe('#uniswapV3SwapCallback', () => {
    it('should handle swap callback correctly', async () => {
      const amountSpecified = expandTo18Decimals(1);
      const sqrtPriceLimitX96 = ethers.BigNumber.from('0'); // No price limit

      // Perform swap
      await wrapper.swapWithDynamicFee(pool.address, wallet.address, true, amountSpecified, sqrtPriceLimitX96, '0x');

      // Check if swap history was updated
      const swapHistory = await wrapper.swapHistory(0);
      expect(swapHistory.amount).to.equal(amountSpecified);
    });
  });

  describe('#uniswapV3MintCallback', () => {
    it('should handle mint callback correctly', async () => {
      const amount = expandTo18Decimals(1);
      const tickLower = startingTick - tickSpacing;
      const tickUpper = startingTick + tickSpacing;

      // Perform mint
      await wrapper.addLiquidityWithDynamicFee(pool.address, wallet.address, tickLower, tickUpper, amount, '0x');

      // Check if tokens were transferred
      const token0 = await pool.token0();
      const token1 = await pool.token1();
      const balance0 = await ethers.provider.getBalance(token0);
      const balance1 = await ethers.provider.getBalance(token1);
      expect(balance0).to.be.gt(0);
      expect(balance1).to.be.gt(0);
    });
  });
});
