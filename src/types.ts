export type ViewName = 'apertura_proxima' | 'ultimos_30_dias' | 'adjudicados';

export interface ActorInput {
    views: ViewName[];
    fetchFullDetail: boolean;
    maxItems: number;
    proxyConfiguration?: Record<string, unknown>;
}

export interface TenderRow {
    numeroProceso: string;
    descripcion: string;
    tipoProcedimiento: string;
    fechaApertura: string;
    estado: string;
    organismo: string;
    vistaOrigen: ViewName;
    controlId: string;
}

export interface TenderDetail {
    textoCompleto: string;
}

export interface TenderRecord {
    numeroProceso: string;
    descripcion: string;
    tipoProcedimiento: string;
    fechaApertura: string;
    estado: string;
    organismo: string;
    vistaOrigen: ViewName;
    detalleCompleto: TenderDetail | null;
    scrapedAt: string;
}

export interface PostbackFields {
    viewState: string;
    viewStateGenerator: string;
}
