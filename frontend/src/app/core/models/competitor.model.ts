export interface CompetitorItem {
  id: number;
  hotelId: number;
  name: string;
}

export interface CompetitorListResponse {
  count: number;
  items: CompetitorItem[];
}

export interface CompetitorItemResponse {
  item: CompetitorItem;
}

export interface DeleteCompetitorResponse {
  deleted: boolean;
  id: number;
}
