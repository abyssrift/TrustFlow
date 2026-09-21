declare module 'react-test-renderer' {
  const TestRenderer: any;
  export const act: (callback: () => void | Promise<void>) => void;
  export default TestRenderer;
}
