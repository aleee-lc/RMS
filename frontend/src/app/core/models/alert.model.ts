export type AlertSeverity = 'low' | 'medium' | 'high';
export type AlertType = 'occupancy' | 'competitive-set' | 'pricing-opportunity' | string;

export interface AlertItem {
  id: number;
  date: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  resolved: boolean;
}

export interface AlertsResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  count: number;
  items: AlertItem[];
}

export interface AlertItemResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  item: AlertItem;
}
