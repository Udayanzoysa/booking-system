import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.TECHWING_SAMPLE_AUTH === '1' ? '.next-sample-auth' : '.next',
  turbopack: { root: process.cwd() },
  agentRules: false,
  devIndicators: false,
};

export default config;
