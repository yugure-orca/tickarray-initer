import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTransactionToast } from '../ui/ui-layout';
import Decimal from 'decimal.js';

import { AccountInfo, GetProgramAccountsFilter } from "@solana/web3.js";
import { ParsableWhirlpool, PriceMath, WhirlpoolData, buildDefaultAccountFetcher, TickArrayData, PoolUtil, TICK_ARRAY_SIZE, TickUtil, MIN_TICK_INDEX, MAX_TICK_INDEX, PDAUtil, PositionData, ParsablePosition, collectFeesQuote, TickArrayUtil, collectRewardsQuote, TokenAmounts, CollectFeesQuote, CollectRewardsQuote, WhirlpoolsConfigData, FeeTierData, ParsableWhirlpoolsConfig, ParsableFeeTier, ParsableTickArray, TickData, PositionBundleData, ParsablePositionBundle, PositionBundleUtil, POSITION_BUNDLE_SIZE, getAccountSize, AccountName, IGNORE_CACHE, WhirlpoolIx, WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID } from "@orca-so/whirlpools-sdk";
import { PositionUtil, PositionStatus } from "@orca-so/whirlpools-sdk/dist/utils/position-util";
import { Address, BN } from "@coral-xyz/anchor";
import { getAmountDeltaA, getAmountDeltaB } from "@orca-so/whirlpools-sdk/dist/utils/math/token-math";
import { AddressUtil, DecimalUtil } from "@orca-so/common-sdk";
import { AccountMetaInfo, bn2u64, getAccountInfo, toFixedDecimal, toMeta, getShortAddressNotation } from "./account";
import moment from "moment";



const V1_WHIRLPOOL_LIST = "https://api.mainnet.orca.so/v1/whirlpool/list";

export type WhirlpoolListEntry = {
  address: PublicKey,
  name: string,
  invertedName: string,
  symbolA: string,
  symbolB: string,
  mintA: PublicKey,
  mintB: PublicKey,
  tickSpacing: number,
  price: Decimal,
  usdTVL: Decimal,
  usdVolumeDay: Decimal,
}

async function getWhirlpoolList(): Promise<WhirlpoolListEntry[]> {
  const response = await (await fetch(V1_WHIRLPOOL_LIST)).json();

  const list: WhirlpoolListEntry[] = [];
  response.whirlpools.forEach((p: any) => {
    const symbolA = warnUndefined(p.tokenA.symbol, p.tokenA.mint);
    const symbolB = warnUndefined(p.tokenB.symbol, p.tokenB.mint);

    list.push({
      address: new PublicKey(p.address),
      name: `${symbolA}/${symbolB}(${p.tickSpacing})`,
      invertedName: `${symbolB}/${symbolA}(${p.tickSpacing})`,
      symbolA,
      symbolB,
      mintA: new PublicKey(p.tokenA.mint),
      mintB: new PublicKey(p.tokenB.mint),
      tickSpacing: p.tickSpacing,
      price: new Decimal(p.price),
      usdTVL: new Decimal(p.tvl ?? 0),
      usdVolumeDay: new Decimal(p.volume?.day ?? 0),
    });
  });

  list.sort(whirlpoolListEntryCmp);

  return list;
}

function whirlpoolListEntryCmp(a: WhirlpoolListEntry, b: WhirlpoolListEntry): number {
  if ( a.symbolA < b.symbolA ) return -1;
  if ( a.symbolA > b.symbolA ) return +1;
  if ( a.symbolB < b.symbolB ) return -1;
  if ( a.symbolB > b.symbolB ) return +1;
  if ( a.tickSpacing < b.tickSpacing ) return -1;
  if ( a.tickSpacing > b.tickSpacing ) return +1;
  return 0;
}

function warnUndefined(s: string | undefined, mint: string): string {
  return s?.trim() || `❓(${getShortAddressNotation(mint, 4)})`;
}

export function useWhirlpools() {
  return useQuery({
    queryKey: ['whirlpools'],
    queryFn: getWhirlpoolList,
  });
}

const V1_TOKEN_LIST = "https://api.mainnet.orca.so/v1/token/list";

export type TokenInfo = {
  mint: PublicKey,
  symbol: string,
  name: string,
  decimals: number,
  logoURI: string,
  coingeckoId: string,
  whitelisted: boolean,
  poolToken: boolean,
}

class TokenList {
  private tokenMintMap: Map<string, TokenInfo>;

  constructor(
    readonly tokenList: TokenInfo[]
  ) {
    this.tokenMintMap = new Map();
    for (const token of tokenList) {
      this.tokenMintMap.set(token.mint.toBase58(), token);
    }
  }

  public getTokenInfoByMint(mint: Address): TokenInfo|undefined {
    return this.tokenMintMap.get(mint.toString());
  }
}

export async function getTokenList(): Promise<TokenList> {
  const response = await (await fetch(V1_TOKEN_LIST)).json();

  const list: TokenInfo[] = [];
  response.tokens.forEach((t: any) => {
    list.push({
      mint: new PublicKey(t.mint),
      symbol: warnUndefined(t.symbol, t.mint),
      name: warnUndefined(t.name, t.mint),
      decimals: t.decimals,
      logoURI: t.logoURI,
      coingeckoId: t.coingeckoId,
      whitelisted: t.whitelisted,
      poolToken: t.poolToken,
    });
  });

  list.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return new TokenList(list);
}


export function useTokens() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: getTokenList,
  });
}


const NEIGHBORING_TICK_ARRAY_NUM = 10;
const ISOTOPE_TICK_SPACINGS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];


type NeighboringTickArray = {
  pubkey: PublicKey,
  startTickIndex: number,
  startPrice: Decimal,
  isInitialized: boolean,
  hasTickCurrentIndex: boolean,
}

type FullRangeTickArray = {
  pubkey: PublicKey,
  startTickIndex: number,
  isInitialized: boolean,
}

type IsotopeWhirlpool = {
  pubkey: PublicKey,
  tickSpacing: number,
  feeRate: Decimal,
  tickCurrentIndex: number,
  price: Decimal,
  liquidity: BN,
}

type WhirlpoolDerivedInfo = {
  price: Decimal,
  invertedPrice: Decimal,
  feeRate: Decimal,
  protocolFeeRate: Decimal,
  decimalsA: number,
  decimalsB: number,
  decimalsR0?: number,
  decimalsR1?: number,
  decimalsR2?: number,
  tokenInfoA?: TokenInfo,
  tokenInfoB?: TokenInfo,
  tokenInfoR0?: TokenInfo,
  tokenInfoR1?: TokenInfo,
  tokenInfoR2?: TokenInfo,
  tokenVaultAAmount: Decimal,
  tokenVaultBAmount: Decimal,
  tokenVaultR0Amount?: Decimal,
  tokenVaultR1Amount?: Decimal,
  tokenVaultR2Amount?: Decimal,
  reward0WeeklyEmission?: Decimal,
  reward1WeeklyEmission?: Decimal,
  reward2WeeklyEmission?: Decimal,
  rewardLastUpdatedTimestamp: moment.Moment,
  fullRangeTickArrays: FullRangeTickArray[],
  neighboringTickArrays: NeighboringTickArray[],
  isotopeWhirlpools: IsotopeWhirlpool[],
  oracle: PublicKey,
  tradableAmounts: TradableAmounts,
  tickArrayTradableAmounts: TickArrayTradableAmounts,
}

export type WhirlpoolInfo = {
  meta: AccountMetaInfo,
  parsed: WhirlpoolData,
  derived: WhirlpoolDerivedInfo,
}

type TradableAmount = {
  tickIndex: number,
  price: Decimal,
  amountA: Decimal,
  amountB: Decimal,
}

type TradableAmounts = {
  upward: TradableAmount[],
  downward: TradableAmount[],
  error: boolean,
}

type TickArrayTradableAmount = {
  tickArrayPubkey: PublicKey,
  tickArrayStartIndex: number,
  tickArrayStartPrice: Decimal,
  tickArrayData: TickArrayData|null,
  amountA: Decimal,
  amountB: Decimal,
}

type TickArrayTradableAmounts = {
  upward: TickArrayTradableAmount[],
  downward: TickArrayTradableAmount[],
  error: boolean,
}

function getTick(tickIndex: number, tickSpacing: number, tickarrays: (TickArrayData | null)[]): TickData|undefined {
  const startTickIndex = TickUtil.getStartTickIndex(tickIndex, tickSpacing);
  for (const tickarray of tickarrays) {
    if (tickarray?.startTickIndex === startTickIndex)
      return TickArrayUtil.getTickFromArray(tickarray, tickIndex, tickSpacing);
  }
  return undefined;
}

function listTradableAmounts(whirlpool: WhirlpoolData, tickArrays: (TickArrayData|null)[], decimalsA: number, decimalsB: number): TradableAmounts {
  let tickIndex: number, nextTickIndex: number;
  let sqrtPrice: BN, nextSqrtPrice: BN;
  let liquidity: BN;
  let nextPrice: Decimal;
  let nextTick: TickData | undefined;

  const tickCurrentIndex = whirlpool.tickCurrentIndex;
  const tickSpacing = whirlpool.tickSpacing;
  const lowerInitializableTickIndex = Math.floor(tickCurrentIndex/tickSpacing)*tickSpacing;
  const upperInitializableTickIndex = lowerInitializableTickIndex + tickSpacing;

  // upward
  tickIndex = whirlpool.tickCurrentIndex;
  sqrtPrice = whirlpool.sqrtPrice;
  liquidity = whirlpool.liquidity;
  const upwardTradableAmount: TradableAmount[] = [];
  for (let i=0; i<10; i++) {
    nextTickIndex = upperInitializableTickIndex + i*tickSpacing;
    nextTick = getTick(nextTickIndex, tickSpacing, tickArrays);
    if ( nextTick === undefined ) nextTickIndex--;
    if ( nextTickIndex <= tickIndex ) break;

    nextSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);
    nextPrice = toFixedDecimal(PriceMath.tickIndexToPrice(nextTickIndex, decimalsA, decimalsB), decimalsB);
    const deltaA = getAmountDeltaA(sqrtPrice, nextSqrtPrice, liquidity, false);
    const deltaB = getAmountDeltaB(sqrtPrice, nextSqrtPrice, liquidity, true);

    upwardTradableAmount.push({
      tickIndex: nextTickIndex,
      price: nextPrice,
      amountA: DecimalUtil.fromBN(new BN(deltaA), decimalsA),
      amountB: DecimalUtil.fromBN(new BN(deltaB), decimalsB),
    });

    if ( nextTick === undefined ) break;
    tickIndex = nextTickIndex;
    sqrtPrice = nextSqrtPrice;
    liquidity = liquidity.add(nextTick.liquidityNet); // left to right, add liquidityNet
  }

  // downward
  tickIndex = whirlpool.tickCurrentIndex;
  sqrtPrice = whirlpool.sqrtPrice;
  liquidity = whirlpool.liquidity;
  const downwardTradableAmount: TradableAmount[] = [];
  for (let i=0; i<10; i++) {
    nextTickIndex = lowerInitializableTickIndex - i*tickSpacing;
    nextTick = getTick(nextTickIndex, tickSpacing, tickArrays);
    if ( nextTick === undefined ) break;

    nextSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);
    nextPrice = toFixedDecimal(PriceMath.tickIndexToPrice(nextTickIndex, decimalsA, decimalsB), decimalsB);
    const deltaA = getAmountDeltaA(sqrtPrice, nextSqrtPrice, liquidity, true);
    const deltaB = getAmountDeltaB(sqrtPrice, nextSqrtPrice, liquidity, false);

    downwardTradableAmount.push({
      tickIndex: nextTickIndex,
      price: nextPrice,
      amountA: DecimalUtil.fromBN(new BN(deltaA), decimalsA),
      amountB: DecimalUtil.fromBN(new BN(deltaB), decimalsB),
    });

    tickIndex = nextTickIndex;
    sqrtPrice = nextSqrtPrice;
    liquidity = liquidity.sub(nextTick.liquidityNet); // right to left, sub liquidityNet
  }

  return {
    upward: upwardTradableAmount,
    downward: downwardTradableAmount,
    error: false,
  }
}

function listTickArrayTradableAmounts(whirlpool: WhirlpoolData, tickArrayStartIndexes: number[], tickArrayPubkeys: PublicKey[], tickArrays: (TickArrayData|null)[], decimalsA: number, decimalsB: number): TickArrayTradableAmounts {
  let tickIndex: number, nextTickIndex: number;
  let sqrtPrice: BN, nextSqrtPrice: BN;
  let liquidity: BN;
  let nextPrice: Decimal;
  let nextTick: TickData | undefined;

  const tickCurrentIndex = whirlpool.tickCurrentIndex;
  const tickSpacing = whirlpool.tickSpacing;
  const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
  const lowerInitializableTickIndex = Math.floor(tickCurrentIndex/tickSpacing)*tickSpacing;
  const upperInitializableTickIndex = lowerInitializableTickIndex + tickSpacing;

  const currentTickArrayStartIndex = Math.floor(tickCurrentIndex / ticksInArray) * ticksInArray;
  const currentTickArrayIndex = (currentTickArrayStartIndex - tickArrayStartIndexes[0]) / ticksInArray;

  // upward
  const upwardTickArrayPubkeys: PublicKey[] = [];
  const upwardTickArrayStartIndexes: number[] = [];
  const upwardTickArrays: (TickArrayData|null)[] = [];
  const upwardAmountA: Decimal[] = [];
  const upwardAmountB: Decimal[] = [];
  for (let i=0; /*i<=3 && */currentTickArrayIndex+i < tickArrayPubkeys.length; i++) {
    upwardTickArrayPubkeys.push(tickArrayPubkeys[currentTickArrayIndex+i]);
    upwardTickArrayStartIndexes.push(tickArrayStartIndexes[currentTickArrayIndex+i]);
    upwardTickArrays.push(tickArrays[currentTickArrayIndex+i]);
    upwardAmountA.push(new Decimal(0));
    upwardAmountB.push(new Decimal(0));
  }

  const upwardLastTickIndex = Math.min(MAX_TICK_INDEX, currentTickArrayStartIndex + upwardTickArrays.length*ticksInArray);
  let upwardIndex = 0;
  tickIndex = whirlpool.tickCurrentIndex;
  sqrtPrice = whirlpool.sqrtPrice;
  liquidity = whirlpool.liquidity;
  for (let i=0; true; i++) {
    nextTickIndex = upperInitializableTickIndex + i*tickSpacing;
    if ( nextTickIndex > upwardLastTickIndex ) break;

    nextSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);
    nextPrice = toFixedDecimal(PriceMath.tickIndexToPrice(nextTickIndex, decimalsA, decimalsB), decimalsB);
    const deltaA = getAmountDeltaA(sqrtPrice, nextSqrtPrice, liquidity, false);
    const deltaB = getAmountDeltaB(sqrtPrice, nextSqrtPrice, liquidity, true);
    const deltaADecimal = DecimalUtil.fromBN(new BN(deltaA), decimalsA);
    const deltaBDecimal = DecimalUtil.fromBN(new BN(deltaB), decimalsB);

    upwardAmountA[upwardIndex] = upwardAmountA[upwardIndex].add(deltaADecimal);
    upwardAmountB[upwardIndex] = upwardAmountB[upwardIndex].add(deltaBDecimal);

    nextTick = getTick(nextTickIndex, tickSpacing, tickArrays);
    if ( nextTick !== undefined ) liquidity = liquidity.add(nextTick.liquidityNet); // left to right, add liquidityNet
    tickIndex = nextTickIndex;
    sqrtPrice = nextSqrtPrice;
    if ( nextTickIndex % ticksInArray === 0 ) upwardIndex++;
  }

  // downward
  const downwardTickArrayPubkeys: PublicKey[] = [];
  const downwardTickArrayStartIndexes: number[] = [];
  const downwardTickArrays: (TickArrayData|null)[] = [];
  const downwardAmountA: Decimal[] = [];
  const downwardAmountB: Decimal[] = [];
  for (let i=0; /*i<=3 && */currentTickArrayIndex-i >= 0; i++) {
    downwardTickArrayPubkeys.push(tickArrayPubkeys[currentTickArrayIndex-i]);
    downwardTickArrayStartIndexes.push(tickArrayStartIndexes[currentTickArrayIndex-i]);
    downwardTickArrays.push(tickArrays[currentTickArrayIndex-i]);
    downwardAmountA.push(new Decimal(0));
    downwardAmountB.push(new Decimal(0));
  }

  const downwardLastTickIndex = Math.max(MIN_TICK_INDEX, currentTickArrayStartIndex - (downwardTickArrays.length - 1)*ticksInArray);
  let downwardIndex = 0;
  tickIndex = whirlpool.tickCurrentIndex;
  sqrtPrice = whirlpool.sqrtPrice;
  liquidity = whirlpool.liquidity;
  for (let i=0; true; i++) {
    nextTickIndex = lowerInitializableTickIndex - i*tickSpacing;
    if ( nextTickIndex < downwardLastTickIndex ) break;

    nextSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(nextTickIndex);
    nextPrice = toFixedDecimal(PriceMath.tickIndexToPrice(nextTickIndex, decimalsA, decimalsB), decimalsB);
    const deltaA = getAmountDeltaA(sqrtPrice, nextSqrtPrice, liquidity, true);
    const deltaB = getAmountDeltaB(sqrtPrice, nextSqrtPrice, liquidity, false);
    const deltaADecimal = DecimalUtil.fromBN(new BN(deltaA), decimalsA);
    const deltaBDecimal = DecimalUtil.fromBN(new BN(deltaB), decimalsB);

    downwardAmountA[downwardIndex] = downwardAmountA[downwardIndex].add(deltaADecimal);
    downwardAmountB[downwardIndex] = downwardAmountB[downwardIndex].add(deltaBDecimal);

    nextTick = getTick(nextTickIndex, tickSpacing, tickArrays);
    if ( nextTick !== undefined ) liquidity = liquidity.sub(nextTick.liquidityNet); // right to left, sub liquidityNet
    tickIndex = nextTickIndex;
    sqrtPrice = nextSqrtPrice;
    if ( nextTickIndex % ticksInArray === 0 ) downwardIndex++;
  }

  const upwardTickArrayTradableAmount: TickArrayTradableAmount[] = [];
  for (let i=0; i<upwardTickArrayPubkeys.length; i++) {
    upwardTickArrayTradableAmount.push({
      tickArrayPubkey: upwardTickArrayPubkeys[i],
      tickArrayStartIndex: upwardTickArrayStartIndexes[i],
      tickArrayStartPrice: toFixedDecimal(PriceMath.tickIndexToPrice(upwardTickArrayStartIndexes[i], decimalsA, decimalsB), decimalsB),
      tickArrayData: upwardTickArrays[i],
      amountA: upwardAmountA[i],
      amountB: upwardAmountB[i],
    })
  }

  const downwardTickArrayTradableAmount: TickArrayTradableAmount[] = [];
  for (let i=0; i<downwardTickArrayPubkeys.length; i++) {
    downwardTickArrayTradableAmount.push({
      tickArrayPubkey: downwardTickArrayPubkeys[i],
      tickArrayStartIndex: downwardTickArrayStartIndexes[i],
      tickArrayStartPrice: toFixedDecimal(PriceMath.tickIndexToPrice(downwardTickArrayStartIndexes[i], decimalsA, decimalsB), decimalsB),
      tickArrayData: downwardTickArrays[i],
      amountA: downwardAmountA[i],
      amountB: downwardAmountB[i],
    })
  }

  return {
    upward: upwardTickArrayTradableAmount,
    downward: downwardTickArrayTradableAmount,
    error: false,
  }
}

export async function getWhirlpoolInfo(connection: Connection, addr: Address, tokenList: TokenList): Promise<WhirlpoolInfo> {
  const pubkey = AddressUtil.toPubKey(addr);
  const fetcher = buildDefaultAccountFetcher(connection);

  const { accountInfo, slotContext } = await getAccountInfo(connection, pubkey);
  const whirlpoolData = ParsableWhirlpool.parse(pubkey, accountInfo)!;

  // get mints
  const mintPubkeys: PublicKey[] = [];
  mintPubkeys.push(whirlpoolData.tokenMintA);
  mintPubkeys.push(whirlpoolData.tokenMintB);
  mintPubkeys.push(whirlpoolData.rewardInfos[0].mint);
  mintPubkeys.push(whirlpoolData.rewardInfos[1].mint);
  mintPubkeys.push(whirlpoolData.rewardInfos[2].mint);
  const mints = await fetcher.getMintInfos(mintPubkeys, IGNORE_CACHE);
  const decimalsA = mints.get(mintPubkeys[0].toBase58())!.decimals;
  const decimalsB = mints.get(mintPubkeys[1].toBase58())!.decimals;
  const decimalsR0 = mints.get(mintPubkeys[2].toBase58())?.decimals;
  const decimalsR1 = mints.get(mintPubkeys[3].toBase58())?.decimals;
  const decimalsR2 = mints.get(mintPubkeys[4].toBase58())?.decimals;

  // get vaults
  const vaultPubkeys: PublicKey[] = [];
  vaultPubkeys.push(whirlpoolData.tokenVaultA);
  vaultPubkeys.push(whirlpoolData.tokenVaultB);
  vaultPubkeys.push(whirlpoolData.rewardInfos[0].vault);
  vaultPubkeys.push(whirlpoolData.rewardInfos[1].vault);
  vaultPubkeys.push(whirlpoolData.rewardInfos[2].vault);
  const vaultsMap = await fetcher.getTokenInfos(vaultPubkeys, IGNORE_CACHE);
  const vaults = [
    vaultsMap.get(vaultPubkeys[0].toBase58()),
    vaultsMap.get(vaultPubkeys[1].toBase58()),
    vaultsMap.get(vaultPubkeys[2].toBase58()),
    vaultsMap.get(vaultPubkeys[3].toBase58()),
    vaultsMap.get(vaultPubkeys[4].toBase58()),
  ];

  // get token name
  const tokenInfoA = tokenList.getTokenInfoByMint(mintPubkeys[0]);
  const tokenInfoB = tokenList.getTokenInfoByMint(mintPubkeys[1]);
  const tokenInfoR0 = tokenList.getTokenInfoByMint(mintPubkeys[2]);
  const tokenInfoR1 = tokenList.getTokenInfoByMint(mintPubkeys[3]);
  const tokenInfoR2 = tokenList.getTokenInfoByMint(mintPubkeys[4]);

  // get neighboring tickarrays
  const ticksInArray = whirlpoolData.tickSpacing * TICK_ARRAY_SIZE;
  const currentStartTickIndex = TickUtil.getStartTickIndex(whirlpoolData.tickCurrentIndex, whirlpoolData.tickSpacing);
  const tickArrayStartIndexes = [];
  const tickArrayPubkeys: PublicKey[] = [];
  for (let offset=-NEIGHBORING_TICK_ARRAY_NUM; offset <= NEIGHBORING_TICK_ARRAY_NUM; offset++) {
    const startTickIndex = TickUtil.getStartTickIndex(whirlpoolData.tickCurrentIndex, whirlpoolData.tickSpacing, offset);
    if ( startTickIndex+ticksInArray <= MIN_TICK_INDEX ) continue;
    if ( startTickIndex > MAX_TICK_INDEX ) continue;
    tickArrayStartIndexes.push(startTickIndex);
    tickArrayPubkeys.push(PDAUtil.getTickArray(accountInfo.owner, pubkey, startTickIndex).publicKey);
  }
  const tickArrays = await fetcher.getTickArrays(tickArrayPubkeys, IGNORE_CACHE);
  const neighboringTickArrays: NeighboringTickArray[] = [];
  tickArrayStartIndexes.forEach((startTickIndex, i) => {
    neighboringTickArrays.push({
      pubkey: tickArrayPubkeys[i],
      startTickIndex,
      startPrice: toFixedDecimal(PriceMath.tickIndexToPrice(startTickIndex, decimalsA, decimalsB), decimalsB),
      isInitialized: !!tickArrays[i],
      hasTickCurrentIndex: startTickIndex === currentStartTickIndex,
    });
  });

  // get full range tickarrays
  const minTickIndex = Math.ceil(MIN_TICK_INDEX / whirlpoolData.tickSpacing) * whirlpoolData.tickSpacing;
  const maxTickIndex = Math.floor(MAX_TICK_INDEX / whirlpoolData.tickSpacing) * whirlpoolData.tickSpacing;
  const minStartTickIndex = TickUtil.getStartTickIndex(minTickIndex, whirlpoolData.tickSpacing);
  const maxStartTickIndex = TickUtil.getStartTickIndex(maxTickIndex, whirlpoolData.tickSpacing);
  const minTickArrayPubkey = PDAUtil.getTickArray(accountInfo.owner, pubkey, minStartTickIndex).publicKey;
  const maxTickArrayPubkey = PDAUtil.getTickArray(accountInfo.owner, pubkey, maxStartTickIndex).publicKey;
  const tickArraysForFullRange = await fetcher.getTickArrays([
    minTickArrayPubkey,
    maxTickArrayPubkey,
  ], IGNORE_CACHE);
  const fullRangeTickArrays: FullRangeTickArray[] = [
    {pubkey: minTickArrayPubkey, startTickIndex: minStartTickIndex, isInitialized: !!tickArraysForFullRange[0]},
    {pubkey: maxTickArrayPubkey, startTickIndex: maxStartTickIndex, isInitialized: !!tickArraysForFullRange[1]},
  ];

  // get isotope whirlpools
  const whirlpoolPubkeys: PublicKey[] = [];
  ISOTOPE_TICK_SPACINGS.forEach((tickSpacing) => {
    whirlpoolPubkeys.push(
      PDAUtil.getWhirlpool(
        accountInfo.owner,
        whirlpoolData.whirlpoolsConfig,
        whirlpoolData.tokenMintA,
        whirlpoolData.tokenMintB,
        tickSpacing,
      ).publicKey
    );
  });
  const whirlpools = await fetcher.getPools(whirlpoolPubkeys, IGNORE_CACHE);
  const isotopeWhirlpools: IsotopeWhirlpool[] = [];
  ISOTOPE_TICK_SPACINGS.forEach((tickSpacing, i) => {
    const whirlpool = whirlpools.get(whirlpoolPubkeys[i].toBase58());
    if (whirlpool) {
      isotopeWhirlpools.push({
        tickSpacing,
        feeRate: PoolUtil.getFeeRate(whirlpool.feeRate).toDecimal().mul(100),
        pubkey: whirlpoolPubkeys[i],
        tickCurrentIndex: whirlpool.tickCurrentIndex,
        price: toFixedDecimal(PriceMath.sqrtPriceX64ToPrice(whirlpool.sqrtPrice, decimalsA, decimalsB), decimalsB),
        liquidity: whirlpool.liquidity,
      });
    }
  });

  // get oracle
  const oracle = PDAUtil.getOracle(accountInfo.owner, pubkey).publicKey;

  let tradableAmounts: TradableAmounts = { downward: [], upward: [], error: true };
  try {
    const calculated = listTradableAmounts(
      whirlpoolData,
      tickArrays.slice(),
      decimalsA,
      decimalsB,
    );
    tradableAmounts = calculated;
  }
  catch ( e ) {console.log(e);}

  let tickArrayTradableAmounts: TickArrayTradableAmounts = { downward: [], upward: [], error: true };
  try {
    const calculated = listTickArrayTradableAmounts(
      whirlpoolData,
      tickArrayStartIndexes,
      tickArrayPubkeys,
      tickArrays.slice(),
      decimalsA,
      decimalsB,
    );
    tickArrayTradableAmounts = calculated;
  }
  catch ( e ) {console.log(e);}

  return {
    meta: toMeta(pubkey, accountInfo, slotContext),
    parsed: whirlpoolData,
    derived: {
      price: toFixedDecimal(PriceMath.sqrtPriceX64ToPrice(whirlpoolData.sqrtPrice, decimalsA, decimalsB), decimalsB),
      invertedPrice: toFixedDecimal(new Decimal(1).div(PriceMath.sqrtPriceX64ToPrice(whirlpoolData.sqrtPrice, decimalsA, decimalsB)), decimalsA),
      feeRate: PoolUtil.getFeeRate(whirlpoolData.feeRate).toDecimal().mul(100),
      protocolFeeRate: PoolUtil.getProtocolFeeRate(whirlpoolData.protocolFeeRate).toDecimal().mul(100),
      decimalsA,
      decimalsB,
      decimalsR0,
      decimalsR1,
      decimalsR2,
      tokenInfoA,
      tokenInfoB,
      tokenInfoR0,
      tokenInfoR1,
      tokenInfoR2,
      tokenVaultAAmount: DecimalUtil.fromBN(vaults[0]!.amount, decimalsA),
      tokenVaultBAmount: DecimalUtil.fromBN(vaults[1]!.amount, decimalsB),
      tokenVaultR0Amount: decimalsR0 === undefined ? undefined : DecimalUtil.fromBN(vaults[2]!.amount, decimalsR0),
      tokenVaultR1Amount: decimalsR1 === undefined ? undefined : DecimalUtil.fromBN(vaults[3]!.amount, decimalsR1),
      tokenVaultR2Amount: decimalsR2 === undefined ? undefined : DecimalUtil.fromBN(vaults[4]!.amount, decimalsR2),
      reward0WeeklyEmission: decimalsR0 === undefined ? undefined : DecimalUtil.fromBN(bn2u64(whirlpoolData.rewardInfos[0].emissionsPerSecondX64.muln(60*60*24*7).shrn(64)), decimalsR0),
      reward1WeeklyEmission: decimalsR1 === undefined ? undefined : DecimalUtil.fromBN(bn2u64(whirlpoolData.rewardInfos[1].emissionsPerSecondX64.muln(60*60*24*7).shrn(64)), decimalsR1),
      reward2WeeklyEmission: decimalsR2 === undefined ? undefined : DecimalUtil.fromBN(bn2u64(whirlpoolData.rewardInfos[2].emissionsPerSecondX64.muln(60*60*24*7).shrn(64)), decimalsR2),
      rewardLastUpdatedTimestamp: moment.unix(whirlpoolData.rewardLastUpdatedTimestamp.toNumber()),
      fullRangeTickArrays,
      neighboringTickArrays,
      isotopeWhirlpools,
      oracle,
      tradableAmounts,
      tickArrayTradableAmounts,
    }
  };
}

export function useWhirlpoolInfo(address: Address) {
  const { connection } = useConnection();
  const tokenList = useTokens();
  return useQuery({
    queryKey: ['whirlpool', { address, endpoint: connection.rpcEndpoint }],
    queryFn: () => getWhirlpoolInfo(connection, address, tokenList.data!),
    enabled: !!tokenList.data,
  });
}







export function useInitializeTickArray({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'initialize-tick-array',
      { endpoint: connection.rpcEndpoint, address },
    ],
    mutationFn: async (input: { tickStartIndex: number }) => {
      let signature: TransactionSignature = '';
      try {
        const ctx = WhirlpoolContext.from(connection, wallet as any, ORCA_WHIRLPOOL_PROGRAM_ID);
        const initialize_tick_array_ix = WhirlpoolIx.initTickArrayIx(ctx.program, {
          funder: wallet.publicKey!,
          startTick: input.tickStartIndex,
          tickArrayPda: PDAUtil.getTickArray(ctx.program.programId, address, input.tickStartIndex),
          whirlpool: address,
        });

        const latestBlockhash = await connection.getLatestBlockhash();
        const messageLegacy = new TransactionMessage({
          payerKey: wallet.publicKey!,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [...initialize_tick_array_ix.instructions],
        }).compileToLegacyMessage();
      
        // Create a new VersionedTransaction which supports legacy and v0
        const transaction = new VersionedTransaction(messageLegacy);
      
        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Send transaction and await for signature
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: ['whirlpool', { address, endpoint: connection.rpcEndpoint }],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}