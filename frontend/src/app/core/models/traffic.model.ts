export type VehicleSnapshot = {
  id: string;
  x: number;
  y: number;
  speed?: number;
  angle?: number;
};

export type TrafficSnapshot = {
  ts: number;
  step: number;
  scenario: string;
  tlsId: string;
  phase: number;
  tlState?: string | null;
  controlledLanes?: string[];
  laneSignalStates?: Record<string, string>;
  lanes: Record<string, number>;
  totalHalted: number;
  vehicles?: VehicleSnapshot[];
  totalVehicles?: number;
  remainingTime?: number;
  tlsMode?: string;
  trafficLevel?: string;
};
