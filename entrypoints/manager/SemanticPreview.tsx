import type { SemanticBlock, SemanticDocument } from '../../src/domain/types';

function Block({ block }: { block: SemanticBlock }) {
  switch (block.type) {
    case 'heading': {
      const Heading = ('h' + Math.min(block.level + 1, 6)) as keyof React.JSX.IntrinsicElements;
      return <Heading>{block.text}</Heading>;
    }
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'list':
      return block.ordered ? (
        <ol>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ol>
      ) : (
        <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
      );
    case 'table':
      return (
        <table>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'code':
      return <pre><code>{block.text}</code></pre>;
    case 'quote':
      return <blockquote>{block.text}</blockquote>;
    case 'figure':
      return (
        <figure>
          {block.dataUrl ? <img src={block.dataUrl} alt={block.alt} /> : null}
          <figcaption>{block.caption || block.alt}</figcaption>
        </figure>
      );
    case 'link':
      return <p><a href={block.url} target="_blank" rel="noreferrer">{block.label}</a></p>;
    case 'section-break':
      return <hr />;
  }
}
export function SemanticPreview({ document }: { document: SemanticDocument }) {
  return (
    <article className="semantic-preview">
      <h1>{document.title}</h1>
      <p className="muted"><a href={document.url} target="_blank" rel="noreferrer">{document.url}</a></p>
      {document.blocks.map((block, index) => <Block key={index} block={block} />)}
    </article>
  );
}
