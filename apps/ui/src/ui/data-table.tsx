import type { ReactNode } from "react";

interface Column<Row> {
  readonly header: string;
  readonly numeric?: boolean;
  readonly cell: (row: Row) => ReactNode;
}

const CELL = "h-(--row-height) border-b border-line px-3 py-2 align-middle";
const HEAD = "h-7 whitespace-nowrap border-b border-line-strong px-3 pb-1 align-bottom text-ink-muted type-label";
const face = (numeric = false) => (numeric ? "text-right type-readout" : "text-left type-body");

/**
 * Dense rows of readouts on hairlines: a caption for assistive tech, label headers, a row header naming each row,
 * numbers right-aligned in the readout face, and each row's actions last under a visually hidden header. It
 * scrolls sideways on a narrow screen.
 *
 * @param props - The caption, the rows and their keys, the row header, the other columns and the row actions.
 * @returns The table.
 */
export const DataTable = <Row extends object>({ caption, rows, rowKey, rowHeader, columns, actions }: {
  readonly caption: string;
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly rowHeader: Column<Row>;
  readonly columns: readonly Column<Row>[];
  readonly actions?: ((row: Row) => ReactNode) | undefined;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {[rowHeader, ...columns].map(({ header, numeric }, index) => (
            <th key={index} scope="col" className={`${HEAD} ${numeric === true ? "text-right" : "text-left"}`}>
              {header}
            </th>
          ))}
          {actions === undefined
            ? null
            : <th scope="col" className={HEAD}><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="hover:bg-surface-raised">
            <th scope="row" className={`${CELL} font-medium ${face(rowHeader.numeric)}`}>{rowHeader.cell(row)}</th>
            {columns.map(({ numeric, cell }, index) => (
              <td key={index} className={`${CELL} ${face(numeric)}`}>{cell(row)}</td>
            ))}
            {actions === undefined ? null : <td className={CELL}>{actions(row)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
