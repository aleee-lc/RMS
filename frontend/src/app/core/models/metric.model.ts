export interface MetricItem {
  date: string;
  occupancy: number;
  adr: number;
  revenue: number;
  booked_rooms: number;
  revpar: number;
}

export interface MetricsResponse {
  hotel: {
    id: number;
    name: string;
    totalRooms: number;
  };
  startDate: string;
  endDate: string;
  count: number;
  items: MetricItem[];
}
