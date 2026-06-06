/// <reference types="vite/client" />

declare module "mammoth/mammoth.browser" {
  interface ExtractRawTextInput {
    arrayBuffer: ArrayBuffer;
  }

  interface ExtractRawTextResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  const mammoth: {
    extractRawText(input: ExtractRawTextInput): Promise<ExtractRawTextResult>;
  };

  export default mammoth;
}

declare namespace React {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
