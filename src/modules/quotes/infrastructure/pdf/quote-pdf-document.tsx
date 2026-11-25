import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { QuoteDocument } from "../../application/quote-document";

/**
 * Sin partición silábica: la de react-pdf sigue reglas del inglés y cortaba
 * palabras en español ("eucalip-to"). Las palabras pasan completas a la
 * línea siguiente.
 */
Font.registerHyphenationCallback((word) => [word]);

/** Paleta de marca (mismos valores que `--color-decor-*` en `globals.css`). */
const COLORS = {
  copper: "#b5714f",
  copperDark: "#9a5b3d",
  copperLight: "#e8d3c6",
  ink: "#1c1c1c",
  inkSoft: "#4a4744",
  surface: "#faf8f5",
} as const;

const styles = StyleSheet.create({
  brand: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: COLORS.ink, fontFamily: "Helvetica-Bold", fontSize: 16 },
  conditions: { color: COLORS.inkSoft, lineHeight: 1.4 },
  fact: { marginBottom: 6, width: "50%" },
  factLabel: { color: COLORS.inkSoft, fontSize: 8, textTransform: "uppercase" },
  facts: { flexDirection: "row", flexWrap: "wrap" },
  factValue: { color: COLORS.ink, fontSize: 10 },
  footer: {
    borderTopColor: COLORS.copperLight,
    borderTopWidth: 1,
    bottom: 24,
    color: COLORS.inkSoft,
    flexDirection: "row",
    fontSize: 8,
    justifyContent: "space-between",
    left: 40,
    paddingTop: 6,
    position: "absolute",
    right: 40,
  },
  grandTotal: {
    borderTopColor: COLORS.copper,
    borderTopWidth: 1.5,
    color: COLORS.copperDark,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginTop: 2,
    paddingTop: 6,
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: COLORS.copper,
    borderBottomWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    paddingBottom: 12,
  },
  headerMeta: { alignItems: "flex-end", gap: 3 },
  logo: { height: 56, width: 56 },
  meta: { color: COLORS.inkSoft, fontSize: 9 },
  num: { textAlign: "right" },
  page: {
    backgroundColor: "#ffffff",
    color: COLORS.ink,
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingBottom: 60,
    paddingHorizontal: 40,
    paddingTop: 36,
  },
  row: {
    borderBottomColor: COLORS.copperLight,
    borderBottomWidth: 0.75,
    flexDirection: "row",
    paddingVertical: 6,
  },
  section: { marginBottom: 16 },
  sectionTitle: {
    color: COLORS.copperDark,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 8,
  },
  status: {
    backgroundColor: COLORS.copperLight,
    borderRadius: 3,
    color: COLORS.copperDark,
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tableHead: {
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.copper,
    borderBottomWidth: 1,
    color: COLORS.inkSoft,
    flexDirection: "row",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  title: { color: COLORS.ink, fontFamily: "Helvetica-Bold", fontSize: 13 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totals: { alignSelf: "flex-end", width: "55%" },
});

/** Anchos de columna: concepto, cantidad, precio unitario, subtotal. */
const COLUMNS = { concept: "46%", quantity: "14%", subtotal: "20%", unitPrice: "20%" } as const;

export type QuotePdfDocumentProps = {
  readonly document: QuoteDocument;
  /** PNG del logo (ya incluye el nombre); sin logo se escribe "DecorAR". */
  readonly logo: Buffer | null;
  /** Fecha de creación de la versión: el PDF no depende de la hora actual. */
  readonly createdAt?: Date;
};

/**
 * Plantilla A4 de la cotización (DECOR-52). Misma estructura que la vista
 * previa (DECOR-51). Cada fila y el bloque de totales usan `wrap={false}`
 * para que un salto de página nunca los corte.
 */
export function QuotePdfDocument({ document, logo, createdAt }: QuotePdfDocumentProps) {
  return (
    <Document
      author="DecorAR"
      creationDate={createdAt}
      creator="DecorAR"
      language="es-CO"
      modificationDate={createdAt}
      producer="DecorAR"
      subject={document.title}
      title={document.title}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf no admite alt.
              <Image src={{ data: logo, format: "png" }} style={styles.logo} />
            ) : (
              <Text style={styles.brandName}>DecorAR</Text>
            )}
          </View>
          <View style={styles.headerMeta}>
            <Text style={styles.title}>{document.title}</Text>
            {document.issuedOn ? <Text style={styles.meta}>Emitida el {document.issuedOn}</Text> : null}
            <Text style={styles.meta}>Válida hasta {document.validUntil}</Text>
            {document.statusLabel ? <Text style={styles.status}>{document.statusLabel}</Text> : null}
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Cliente y evento</Text>
          <View style={styles.facts}>
            {document.facts.map((fact) => (
              <View key={fact.label} style={styles.fact}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text minPresenceAhead={60} style={styles.sectionTitle}>
            Conceptos
          </Text>
          {document.lines.length === 0 ? (
            <Text style={styles.meta}>Esta cotización no tiene conceptos.</Text>
          ) : (
            <>
              <View minPresenceAhead={30} style={styles.tableHead} wrap={false}>
                <Text style={{ width: COLUMNS.concept }}>Concepto</Text>
                <Text style={[styles.num, { width: COLUMNS.quantity }]}>Cantidad</Text>
                <Text style={[styles.num, { width: COLUMNS.unitPrice }]}>Precio unitario</Text>
                <Text style={[styles.num, { width: COLUMNS.subtotal }]}>Subtotal</Text>
              </View>
              {document.lines.map((line) => (
                <View key={line.key} style={styles.row} wrap={false}>
                  <Text style={{ paddingRight: 6, width: COLUMNS.concept }}>{line.concept}</Text>
                  <Text style={[styles.num, { width: COLUMNS.quantity }]}>{line.quantity}</Text>
                  <Text style={[styles.num, { width: COLUMNS.unitPrice }]}>{line.unitPrice}</Text>
                  <Text style={[styles.num, { width: COLUMNS.subtotal }]}>{line.subtotal}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={[styles.section, styles.totals]} wrap={false}>
          <Text style={styles.sectionTitle}>Totales</Text>
          {document.totals.map((total) => (
            <View key={total.label} style={total.emphasis ? [styles.totalRow, styles.grandTotal] : styles.totalRow}>
              <Text>{total.label}</Text>
              <Text>{total.value}</Text>
            </View>
          ))}
        </View>

        {document.conditions ? (
          <View style={styles.section}>
            <Text minPresenceAhead={30} style={styles.sectionTitle}>
              Condiciones
            </Text>
            <Text style={styles.conditions}>{document.conditions}</Text>
          </View>
        ) : null}

        <View fixed style={styles.footer}>
          <Text>{document.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
