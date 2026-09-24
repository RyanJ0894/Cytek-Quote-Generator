// The normalized data files are imported as JSON and validated at runtime by
// createStaticDataSource(); typing them as `unknown` here keeps tsc from
// inferring a literal type over several thousand records.
declare module "*.json" {
  const value: unknown;
  export default value;
}
