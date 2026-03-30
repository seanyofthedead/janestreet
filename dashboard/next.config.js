/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow importing Melange-compiled JS from outside dashboard dir
    externalDir: true,
  },
};

export default nextConfig;
