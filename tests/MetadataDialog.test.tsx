// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataDialog, type MetaRequest } from '../src/components/MetadataDialog.tsx';
import { setUpDom } from './dom.tsx';
import { crane } from './factories.ts';
import { stubFetch } from './fetchStub.ts';
import { stubXhr, type UploadReply } from './fakeXhr.tsx';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

function open(request: MetaRequest, reply: UploadReply = { status: 201, body: crane() }) {
  const sent = stubXhr(() => reply);
  const props = { onClose: vi.fn(), onSaved: vi.fn(), onBulk: vi.fn(), onSwitch: vi.fn() };
  render(
    <MetadataDialog
      request={request}
      facets={{ makes: ['Liebherr', 'Tadano'], types: ['Mobile'] }}
      {...props}
    />
  );
  return { ...props, sent };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const fill = (values: Record<string, string>) => {
  for (const [label, value] of Object.entries(values))
    fireEvent.change(field(label), { target: { value } });
};

describe('uploading a crane', () => {
  it('prefills make and model from a dropped file name, then uploads', async () => {
    const { onSaved, sent } = open({ mode: 'upload', file: pdf('Grove GMK5150 (Load Chart).pdf') });
    const dialog = screen.getByRole('dialog', { name: 'Upload crane specification' });
    expect(within(dialog).getByText('Grove GMK5150 (Load Chart).pdf')).toBeInTheDocument();
    expect(field('Manufacturer')).toHaveValue('Grove');
    expect(field('Model')).toHaveValue('GMK5150');
    expect(field('Manufacturer')).toHaveAttribute('list');
    fill({ Type: 'Mobile', 'Rated capacity': ' 150t ' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0]?.[0].mode).toBe('upload');
    const form = sent[0]?.form;
    expect(sent[0]?.url).toBe('/api/upload');
    expect([...(form?.keys() ?? [])]).toEqual(['file', 'make', 'type', 'model', 'capacity']);
    expect(form?.get('capacity')).toBe('150t');
  });

  it('asks for a file and all four details, inside the dialog', async () => {
    open({ mode: 'upload' });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a PDF first.');
    fireEvent.change(screen.getByLabelText('PDF file'), { target: { files: [pdf('a b.pdf')] } });
    fill({ Model: '' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('All four fields are required.');
    expect(document.activeElement).toBe(field('Type'));
  });

  it('shows a server refusal and stays open', async () => {
    const { onSaved } = open(
      { mode: 'upload', file: pdf('Tadano AC100.pdf') },
      { status: 409, body: { error: 'File with these specifications already exists' } }
    );
    fill({ Type: 'Mobile', 'Rated capacity': '100t' });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('hands several PDFs to the bulk importer', () => {
    const { onBulk } = open({ mode: 'upload' });
    const files = [pdf('a.pdf'), pdf('b.pdf')];
    fireEvent.change(screen.getByLabelText('PDF file'), { target: { files } });
    expect(onBulk).toHaveBeenCalledWith(files);
  });

  it('takes a PDF dropped on the picker, refusing anything else', () => {
    open({ mode: 'upload' });
    const box = screen.getByRole('button', { name: /Click to choose a PDF/ })
      .parentElement as HTMLElement;
    fireEvent.dragOver(box);
    expect(box).toHaveClass('is-dragover');
    fireEvent.dragLeave(box);
    fireEvent.drop(box, { dataTransfer: { files: [new File(['x'], 'notes.txt')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Only PDF files can be uploaded.');
    fireEvent.drop(box, { dataTransfer: { files: [pdf('Liebherr LTM1100.pdf')] } });
    expect(field('Manufacturer')).toHaveValue('Liebherr');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the file picker from its button, and cancels', () => {
    const { onClose } = open({ mode: 'upload' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    const input = screen.getByLabelText('PDF file');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: /Click to choose a PDF/ }));
    expect(click).toHaveBeenCalled();
  });
});

describe('editing a crane', () => {
  it('saves the details through the API', async () => {
    const c = crane({ make: 'Tadano', model: 'AC100', capacity: '100t' });
    const fetchMock = stubFetch(() => ({
      body: { ...c, success: true, renamed: true, old_name: c.id },
    }));
    const props = { onClose: vi.fn(), onSaved: vi.fn(), onBulk: vi.fn(), onSwitch: vi.fn() };
    render(
      <MetadataDialog
        request={{ mode: 'edit', crane: c }}
        facets={{ makes: [], types: [] }}
        {...props}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Edit specification' })).toBeInTheDocument();
    expect(screen.queryByLabelText('PDF file')).toBeNull();
    fill({ 'Rated capacity': '200t' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(props.onSaved.mock.calls[0]?.[0]).toMatchObject({ mode: 'edit', oldId: c.id });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/metadata/${c.id}`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      make: 'Tadano',
      type: 'Mobile',
      model: 'AC100',
      capacity: '200t',
    });
  });
});

describe('adding a file', () => {
  it('uploads the file with its label to the crane', async () => {
    const c = crane({ make: 'Grove', model: 'GMK' });
    const { onSaved, sent } = open({ mode: 'addfile', crane: c, file: pdf('dims.pdf') });
    expect(screen.getByRole('dialog', { name: 'Add file to Grove GMK' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Manufacturer')).toBeNull();
    fill({ 'File label — optional': ' Dims ' });
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent[0]?.url).toBe(`/api/cranes/${c.id}/files`);
    expect(sent[0]?.form.get('label')).toBe('Dims');
  });

  it('offers a new crane instead, keeping the file', () => {
    const file = pdf('dims.pdf');
    const { onSwitch } = open({ mode: 'addfile', crane: crane(), file });
    fireEvent.click(screen.getByRole('button', { name: /Create a new crane instead/ }));
    expect(onSwitch).toHaveBeenCalledWith({ mode: 'upload', file });
  });

  it('only takes one file at a time', () => {
    open({ mode: 'addfile', crane: crane() });
    expect(screen.getByLabelText('PDF file')).not.toHaveAttribute('multiple');
    fireEvent.change(screen.getByLabelText('PDF file'), { target: { files: [] } });
    fireEvent.click(screen.getByRole('button', { name: /Create a new crane instead/ }));
  });
});
