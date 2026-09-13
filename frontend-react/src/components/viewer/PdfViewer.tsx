import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2 } from 'lucide-react';

// Configure worker to matching version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface PdfViewerProps {
  url: string;
  onPageCountChange?: (count: number) => void;
}

export function PdfViewer({ url, onPageCountChange }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState<number>(1);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load document
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);
    setPageNum(1);

    const loadingTask = pdfjsLib.getDocument({
      url,
      withCredentials: false,
    });

    loadingTask.promise
      .then((loadedDoc) => {
        if (isCancelled) return;
        setPdfDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setIsLoading(false);
        if (onPageCountChange) {
          onPageCountChange(loadedDoc.numPages);
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error('Error loading PDF:', err);
        setError('Failed to render PDF preview: ' + (err.message || String(err)));
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      loadingTask.destroy();
    };
  }, [url, onPageCountChange]);

  // Render current page
  const renderPage = useCallback(
    async (num: number, doc: any) => {
      if (!doc || !canvasRef.current) return;
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const page = await doc.getPage(num);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const viewport = page.getViewport({ scale, rotation });

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          transform: transform || undefined,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Page render error:', err);
        }
      }
    },
    [scale, rotation]
  );

  useEffect(() => {
    if (pdfDoc) {
      renderPage(pageNum, pdfDoc);
    }
  }, [pdfDoc, pageNum, renderPage]);

  const handlePrevPage = () => {
    if (pageNum > 1) setPageNum((prev) => prev - 1);
  };

  const handleNextPage = () => {
    if (pageNum < numPages) setPageNum((prev) => prev + 1);
  };

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.2, 3.0));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.2, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  return (
    <div className="flex flex-col items-center w-full bg-slate-950/60 rounded-xl border border-slate-800 p-4">
      {/* Viewer Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 w-full pb-3 border-b border-slate-800 mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePrevPage}
            disabled={pageNum <= 1 || isLoading}
            className="h-8 px-2"
            aria-label="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-slate-300 font-medium px-2">
            Page {pageNum} of {numPages || 1}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleNextPage}
            disabled={pageNum >= numPages || isLoading}
            className="h-8 px-2"
            aria-label="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleZoomOut}
            disabled={isLoading}
            className="h-8 px-2"
            aria-label="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-slate-400 font-mono">{Math.round(scale * 100)}%</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleZoomIn}
            disabled={isLoading}
            className="h-8 px-2"
            aria-label="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRotate}
            disabled={isLoading}
            className="h-8 px-2 ml-2"
            aria-label="Rotate Clockwise"
          >
            <RotateCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Canvas / States */}
      <div className="relative min-h-[450px] w-full flex items-center justify-center overflow-auto p-2 bg-slate-900/40 rounded-lg">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-aws-orange" />
            <span className="text-sm">Rendering PDF Document...</span>
          </div>
        )}

        {error && (
          <div className="text-center p-6 text-red-400 bg-red-950/20 border border-red-900/40 rounded-lg">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`shadow-2xl rounded max-w-full transition-opacity duration-200 ${
            isLoading || error ? 'hidden' : 'block'
          }`}
        />
      </div>
    </div>
  );
}
