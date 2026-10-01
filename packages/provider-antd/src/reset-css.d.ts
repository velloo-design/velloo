/** antd's global reset, imported as text so the render pass can inline it. */
declare module "antd/dist/reset.css" {
  const css: string;
  export default css;
}
