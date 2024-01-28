import { WhirlpoolInfo } from './whirlpool-ui';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';

export default function WhirlpoolDefailFeature() {
  const params = useParams();
  const address = useMemo(() => {
    if (!params.address) {
      return;
    }
    try {
      return new PublicKey(params.address);
    } catch (e) {
      console.log(`Invalid public key`, e);
    }
  }, [params]);
  if (!address) {
    return <div>Error loading account</div>;
  }

  return (
    <div className="hero py-[64px]">
      <div className="hero-content text-center">
        <WhirlpoolInfo address={address} />
      </div>
    </div>
  );
}
