/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Orbital catalog data files can be large; allow them to be served statically.
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
