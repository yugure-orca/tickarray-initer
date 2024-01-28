import { useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AppModal, ellipsify } from '../ui/ui-layout';
import { useCluster } from '../cluster/cluster-data-access';
import { ExplorerLink } from '../cluster/cluster-ui';
import { Navigate, Link } from 'react-router-dom';
import { getShortAddressNotation } from './account';

import {
  WhirlpoolListEntry,
  useWhirlpools,
  useWhirlpoolInfo,
  TokenInfo,
  useInitializeTickArray,
} from './whirlpool-data-access';
import Decimal from 'decimal.js';
import { PriceMath, TICK_ARRAY_SIZE } from '@orca-so/whirlpools-sdk';

export function Whirlpools() {
  const query = useWhirlpools();
  const items = query.data;

  return (
    <div className="space-y-2">
      <div className="justify-between">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold">Whirlpools</h2>
          <div className="space-x-2">
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  await query.refetch();
                }}
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No whirlpools found.</div>
          ) : (
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>name</th>
                  <th>tickSpacing</th>
                  <th className="text-right">price</th>
                  <th className="text-right">TVL</th>
                  <th className="text-right">24H Volume</th>
                </tr>
              </thead>
              <tbody>
                {items?.map((item) => (
                  <tr key={item.address.toString()}>
                    <td>
                      <div className="flex space-x-2">
                        <span className="font-mono">
                          <Link to={`${item.address.toString()}`}>
                            {item.name}
                          </Link>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex space-x-2">
                        <span className="font-mono">
                          {item.tickSpacing}
                        </span>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="font-mono">
                        {item.price.toSignificantDigits(4).toString()}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="font-mono">
                        {item.usdTVL.toFixed(0)}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="font-mono">
                        {item.usdVolumeDay.toFixed(0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}


export function WhirlpoolInfo({ address }: { address: PublicKey }) {
  const query = useWhirlpoolInfo(address);
  const data = query.data;

  const getSymbolIfExists = (token: TokenInfo|undefined) => {
    if (token === undefined) {
      return "";
    }
    if (token.symbol === "") {
      return "";
    }
    return `(${token.symbol})`;
  }

  const INITIALIZED = "initialized";
  const NOT_INITIALIZED = "NOT INITIALIZED";
/*
  const tradableA = useMemo(() => {
    const map = new Map<string, Decimal>();
    data?.derived.tickArrayTradableAmounts.upward.forEach((ta) => map.set(ta.tickArrayPubkey.toString(), ta.amountA));
    //data?.derived.tickArrayTradableAmounts.downward.forEach((ta) => map.set(ta.tickArrayPubkey.toString(), ta.amountA));
    return map;
  }, [data]);
  const tradableB = useMemo(() => {
    const map = new Map<string, Decimal>();
    //data?.derived.tickArrayTradableAmounts.upward.forEach((ta) => map.set(ta.tickArrayPubkey.toString(), ta.amountB));
    data?.derived.tickArrayTradableAmounts.downward.forEach((ta) => map.set(ta.tickArrayPubkey.toString(), ta.amountB));
    return map;
  }, [data]);
*/
  return (
    <div className="space-y-2">
      <div className="justify-between">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold mr-4">
            {address.toString()}
          </h2>
          <div className="space-x-2">
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  await query.refetch();
                }}
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {!query.data ? (
            <div>No whirlpool found.</div>
          ) : (
            <div>
            <h3 className="text-xl font-bold my-4">Pool Data</h3>
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>field</th>
                  <th>value</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>whirlpoolsConfig</td><td>{data?.parsed.whirlpoolsConfig.toString()}</td></tr>
                <tr><td>tokenMintA</td><td>{data?.parsed.tokenMintA.toString()} {getSymbolIfExists(data?.derived.tokenInfoA)}</td></tr>
                <tr><td>tokenMintB</td><td>{data?.parsed.tokenMintB.toString()} {getSymbolIfExists(data?.derived.tokenInfoB)}</td></tr>
                <tr><td>tickSpacing</td><td>{data?.parsed.tickSpacing}</td></tr>
                <tr><td>liquidity</td><td>{data?.parsed.liquidity.toString()}</td></tr>
                <tr><td>sqrtPrice</td><td>{data?.parsed.sqrtPrice.toString()}</td></tr>
                <tr><td>tickCurrentIndex</td><td>{data?.parsed.tickCurrentIndex}</td></tr>
                <tr><td>feeRate</td><td>{data?.parsed.feeRate} ({data?.derived.feeRate.toString()}%)</td></tr>
                <tr><td>protocolFeeFate</td><td>{data?.parsed.protocolFeeRate} ({data?.derived.protocolFeeRate.toString()}%)</td></tr>
                <tr><td>price [B/A]</td><td>{data?.derived.price.toSignificantDigits(6).toString()}</td></tr>
                <tr><td>invertedPrice [A/B]</td><td>{data?.derived.invertedPrice.toSignificantDigits(6).toString()}</td></tr>
                <tr><td>tokenVaultA</td><td>{data?.derived.tokenVaultAAmount.toString()} {getSymbolIfExists(data?.derived.tokenInfoA)}</td></tr>
                <tr><td>tokenVaultB</td><td>{data?.derived.tokenVaultBAmount.toString()} {getSymbolIfExists(data?.derived.tokenInfoB)}</td></tr>
              </tbody>
            </table>

            <h3 className="text-xl font-bold my-4">TickArray For FullRange</h3>
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>initialized</th>
                  <th>start tick</th>
                  <th>pubkey</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr className={data?.derived.fullRangeTickArrays[1].isInitialized ? "": "bg-gray-500"}>
                  <td>{data?.derived.fullRangeTickArrays[1].isInitialized ? INITIALIZED : NOT_INITIALIZED}</td>
                  <td>{data?.derived.fullRangeTickArrays[1].startTickIndex} (max)</td>
                  <td>{getShortAddressNotation(data?.derived.fullRangeTickArrays[1].pubkey.toString()!)}</td>
                  <td><InitializeTickArray initialized={data?.derived.fullRangeTickArrays[1].isInitialized ?? false} whirlpool={data?.meta.pubkey!} tickStartIndex={data?.derived.fullRangeTickArrays[1].startTickIndex!} /></td>
                </tr>
                <tr className={data?.derived.fullRangeTickArrays[0].isInitialized ? "": "bg-gray-500"}>
                  <td>{data?.derived.fullRangeTickArrays[0].isInitialized ? INITIALIZED : NOT_INITIALIZED}</td>
                  <td>{data?.derived.fullRangeTickArrays[0].startTickIndex} (min)</td>
                  <td>{getShortAddressNotation(data?.derived.fullRangeTickArrays[0].pubkey.toString()!)}</td>
                  <td><InitializeTickArray initialized={data?.derived.fullRangeTickArrays[0].isInitialized ?? false} whirlpool={data?.meta.pubkey!} tickStartIndex={data?.derived.fullRangeTickArrays[0].startTickIndex!} /></td>
                </tr>
              </tbody>
            </table>

            <h3 className="text-xl font-bold my-4">Neighboring TickArrays</h3>
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>initialized</th>
                  <th>start tick</th>
                  <th>price range</th>
                  <th>tradableA {getSymbolIfExists(data?.derived.tokenInfoA)}</th>
                  <th>tradableB {getSymbolIfExists(data?.derived.tokenInfoB)}</th>
                  <th>pubkey</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data?.derived.tickArrayTradableAmounts.upward.slice().reverse().map((ta) => (
                  <tr className={!!ta.tickArrayData ? "": "bg-gray-500"}>
                    <td>{!!ta.tickArrayData ? INITIALIZED : NOT_INITIALIZED}</td>
                    <td>{ta.tickArrayStartIndex}</td>
                    <td>~ {(() => {
                      const tickArrayEndIndex = ta.tickArrayStartIndex + data?.parsed.tickSpacing * TICK_ARRAY_SIZE;
                      const price = PriceMath.tickIndexToPrice(tickArrayEndIndex, data?.derived.decimalsA, data?.derived.decimalsB);
                      const deltaPercent = price.div(data?.derived.price).sub(1).mul(100);
                      return `${price.toSignificantDigits(6).toString()} (+${deltaPercent.toFixed(2)}%)`;
                      })()}</td>
                    <td className={!!ta.tickArrayData ? "bg-pink-900" : ""}>{ta.amountA.toString()}</td>
                    <td>{ta.amountB.toString()}</td>
                    <td>{getShortAddressNotation(ta.tickArrayPubkey.toString())}</td>
                    <td><InitializeTickArray initialized={!!ta.tickArrayData} whirlpool={data?.meta.pubkey} tickStartIndex={ta.tickArrayStartIndex} /></td>
                  </tr>
                ))}
                {data?.derived.tickArrayTradableAmounts.downward.map((ta) => (
                  <tr className={!!ta.tickArrayData ? "": "bg-gray-500"}>
                    <td>{!!ta.tickArrayData ? INITIALIZED : NOT_INITIALIZED}</td>
                    <td>{ta.tickArrayStartIndex}</td>
                    <td>~ {(() => {
                      const tickArrayEndIndex = ta.tickArrayStartIndex;
                      const price = PriceMath.tickIndexToPrice(tickArrayEndIndex, data?.derived.decimalsA, data?.derived.decimalsB);
                      const deltaPercent = price.div(data?.derived.price).sub(1).mul(100);
                      return `${price.toSignificantDigits(6).toString()} (${deltaPercent.toFixed(2)}%)`;
                      })()}</td>
                    <td>{ta.amountA.toString()}</td>
                    <td className={!!ta.tickArrayData ? "bg-blue-900" : ""}>{ta.amountB.toString()}</td>
                    <td>{getShortAddressNotation(ta.tickArrayPubkey.toString())}</td>
                    <td><InitializeTickArray initialized={!!ta.tickArrayData} whirlpool={data?.meta.pubkey} tickStartIndex={ta.tickArrayStartIndex} /></td>
                  </tr>
                ))}                
              </tbody>
            </table>



            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InitializeTickArray({ initialized, whirlpool, tickStartIndex } : { initialized: boolean, whirlpool: PublicKey, tickStartIndex: number }) {
  const mutation = useInitializeTickArray({ address: whirlpool });

  if (initialized) return undefined;

  return <button className="btn btn-xs lg:btn-md btn-outline" onClick={
    async () => {
      await mutation.mutateAsync({ tickStartIndex });
    }
  }>Initialize</button>
}