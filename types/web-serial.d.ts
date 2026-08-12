interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialOutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

interface SerialInputSignals {
  dataCarrierDetect: boolean;
  dataSetReady: boolean;
  ringIndicator: boolean;
  dataTerminalReady: boolean;
}

interface SerialPort {
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  setSignals(signals?: SerialOutputSignals): Promise<void>;
  getSignals(): Promise<SerialInputSignals>;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  serialNumber?: string;
  manufacturerName?: string;
  productName?: string;
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(type: string, listener: (event: { port: SerialPort }) => void): void;
  removeEventListener(type: string, listener: (event: { port: SerialPort }) => void): void;
}

interface Navigator {
  serial: Serial;
}
