export type AlertSeverity = 'low' | 'medium' | 'high';

export interface AlertItem {
  id: number;
  date: string;
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
