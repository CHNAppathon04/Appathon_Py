// app/components/CSVMapper.tsx
'use client';

import React, { useState, useCallback } from 'react';
import { Upload, ArrowRight, Check, AlertCircle, RefreshCw, X, Loader2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Types definitions
export interface ColumnMapping {
  vendor_field: string;
  target_field: string;
  data_type: string;
  sample_value: string;
}

export interface MappingResponse {
  filename: string;
  content: string;  // CSV content as string
}

export interface ParsedMapping {
  vendor_field: string;
  target_field: string;
  data_type: string;
  sample_value: string;
  confidence: number;
}

export interface PreviewData {
  [key: string]: string;
}

export default function CSVMapper() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [mappings, setMappings] = useState<ParsedMapping[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentMapping, setCurrentMapping] = useState<ParsedMapping | null>(null);
  const [resolvedField, setResolvedField] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const onSourceDrop = useCallback((acceptedFiles: File[]) => {
    setSourceFile(acceptedFiles[0]);
  }, []);

  const onTargetDrop = useCallback((acceptedFiles: File[]) => {
    setTargetFile(acceptedFiles[0]);
  }, []);

  const { getRootProps: getSourceRootProps, getInputProps: getSourceInputProps } = useDropzone({
    onDrop: onSourceDrop,
    accept: {
      'text/csv': ['.csv']
    },
    maxFiles: 1
  });

  const { getRootProps: getTargetRootProps, getInputProps: getTargetInputProps } = useDropzone({
    onDrop: onTargetDrop,
    accept: {
      'text/csv': ['.csv']
    },
    maxFiles: 1
  });

  const parseCSVContent = (content: string): ParsedMapping[] => {
    const lines = content.split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1)
      .filter(line => line.trim())
      .map(line => {
        const values = line.split(',');
        return {
          vendor_field: values[0],
          target_field: values[1],
          data_type: values[2],
          sample_value: values[3],
          confidence: calculateConfidence(values[0], values[1]),
        };
      });
  };

  const parsePreviewData = (content: string): PreviewData[] => {
    const lines = content.split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1)
      .filter(line => line.trim())
      .map(line => {
        const values = line.split(',');
        const row: PreviewData = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        return row;
      });
  };

  const calculateConfidence = (vendorField: string, targetField: string): number => {
    const vendorLower = vendorField.toLowerCase();
    const targetLower = targetField.toLowerCase();

    // Exact match
    if (vendorLower === targetLower) return 0.95;

    // Partial match (e.g., "name" vs. "first_name")
    if (vendorLower.includes(targetLower) || targetLower.includes(vendorLower)) return 0.85;

    // Default confidence
    return 0.7;
  };

  const isAmbiguous = (vendorField: string, targetField: string): boolean => {
    const vendorLower = vendorField.toLowerCase();
    const targetLower = targetField.toLowerCase();

    // Check for ambiguous cases (e.g., "first_name" and "last_name" vs. "name")
    const vendorTokens = vendorLower.split('_');
    const targetTokens = targetLower.split('_');

    // If one field is a combination of multiple fields, it's ambiguous
    return vendorTokens.length !== targetTokens.length;
  };

  const handleResolveAmbiguity = (mapping: ParsedMapping) => {
    setCurrentMapping(mapping);
    setIsModalOpen(true);
  };

  const handleModalClose = (choice: 'combine' | 'first' | 'last') => {
    if (currentMapping) {
      let resolvedFieldValue = '';
      switch (choice) {
        case 'combine':
          resolvedFieldValue = `${currentMapping.vendor_field} ${currentMapping.target_field}`;
          break;
        case 'first':
          resolvedFieldValue = currentMapping.vendor_field;
          break;
        case 'last':
          resolvedFieldValue = currentMapping.target_field;
          break;
      }
      setResolvedField(resolvedFieldValue);
      setIsModalOpen(false);

      // Update the mappings with the resolved field
      setMappings(prevMappings =>
        prevMappings.map(m =>
          m === currentMapping ? { ...m, target_field: resolvedFieldValue, confidence: 1.0 } : m
        )
      );
    }
  };

  const generateMappings = async () => {
    if (!sourceFile || !targetFile) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('vendor_file', sourceFile);
      formData.append('target_file', targetFile);

      const response = await fetch(
        'http://localhost:8002/generate_mapping?vendor_name=Vendor_A',
        {
          method: 'POST',
          body: formData,
        }
      );

      const data: MappingResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.content || 'Failed to generate mappings');
      }

      // Parse the CSV content from the response
      const parsedMappings = parseCSVContent(data.content);

      // Check for ambiguous mappings
      const ambiguousMappings = parsedMappings.filter(mapping =>
        isAmbiguous(mapping.vendor_field, mapping.target_field)
      );

      if (ambiguousMappings.length > 0) {
        // Handle the first ambiguous mapping
        handleResolveAmbiguity(ambiguousMappings[0]);
      }

      // Set the mappings (including resolved ones)
      setMappings(parsedMappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmMappings = async () => {
    if (!sourceFile || !targetFile) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('vendor_file', sourceFile);
      formData.append('target_file', targetFile);

      const response = await fetch(
        'http://localhost:8003/start-etl?vendor_name=Vendor_A',
        {
          method: 'POST',
          body: formData,
        }
      );

      const data = await response.text();

      if (!response.ok) {
        throw new Error('Failed to start ETL');
      }

      // Parse the CSV content from the response
      const parsedData = parsePreviewData(data);

      // Set the preview data
      setPreviewData(parsedData);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (confidence: number) => {
    if (confidence >= 0.9) return 'bg-green-50 border-green-200 text-green-700';
    if (confidence >= 0.7) return 'bg-blue-50 border-blue-200 text-blue-700';
    return 'bg-amber-50 border-amber-200 text-amber-700';
  };

  const handleRemoveFile = (type: 'source' | 'target') => {
    if (type === 'source') setSourceFile(null);
    else setTargetFile(null);
    setMappings([]);
    setShowPreview(false);
  };

  const downloadCSV = () => {
    const csvContent = 'data:text/csv;charset=utf-8,' + previewData.map(row =>
      Object.values(row).join(',')
    ).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'mapped_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-6">
      {/* File Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Source File Upload */}
        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Upload className="h-5 w-5" /> Source CSV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div {...getSourceRootProps()} className="relative">
              <input {...getSourceInputProps()} />
              <div className={`
                border-2 border-dashed rounded-lg p-8 text-center
                transition-colors duration-200 ease-in-out
                ${sourceFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}
              `}>
                {sourceFile ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{sourceFile.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile('source');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-gray-400" />
                    <p className="text-sm text-gray-600">Drop your source CSV file here or click to browse</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Target File Upload */}
        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Upload className="h-5 w-5" /> Target CSV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div {...getTargetRootProps()} className="relative">
              <input {...getTargetInputProps()} />
              <div className={`
                border-2 border-dashed rounded-lg p-8 text-center
                transition-colors duration-200 ease-in-out
                ${targetFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}
              `}>
                {targetFile ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{targetFile.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile('target');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-gray-400" />
                    <p className="text-sm text-gray-600">Drop your target CSV file here or click to browse</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generate Mappings Button */}
      {sourceFile && targetFile && !mappings.length && (
        <div className="flex justify-center">
          <Button
            onClick={generateMappings}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Mappings...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Generate Mappings
              </>
            )}
          </Button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Mapping Visualization */}
      {mappings.length > 0 && (
        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Column Template</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 font-semibold text-gray-700">
                <div>Source CSV</div>
                <div></div>
                <div>Target CSV</div>
              </div>
              {mappings.map((mapping, index) => (
                <div key={index} className="flex items-center gap-4 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-1/3 p-3 rounded-md border border-gray-200 bg-white shadow-sm">
                    <span className="font-medium">{mapping.vendor_field}</span>
                    <div className="text-xs text-gray-500 mt-1">
                      Type: {mapping.data_type}
                      <br />
                      Sample: {mapping.sample_value}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <ArrowRight className={`h-5 w-5 ${
                      mapping.confidence < 0.7 ? 'text-amber-500' : 'text-blue-500'
                    }`} />
                  </div>

                  <div className={`w-1/3 p-3 rounded-md border shadow-sm ${getStatusColor(mapping.confidence)}`}>
                    <span className="font-medium">{mapping.target_field}</span>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-green-500" />
                      <span>{(mapping.confidence * 100).toFixed(0)}% match</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Preview */}
      {showPreview && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Mapped CSV Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {previewData.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(previewData[0]).map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(0, 10).map((row, index) => (
                      <TableRow key={index}>
                        {Object.values(row).map((value, cellIndex) => (
                          <TableCell key={cellIndex}>{value as React.ReactNode}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end mt-4">
                  <Button onClick={downloadCSV} className="bg-blue-600 hover:bg-blue-700">
                    <Download className="h-4 w-4 mr-2" />
                    Download CSV
                  </Button>
                </div>
              </>
            ) : (
              <p>No data available</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {mappings.length > 0 && (
        <div className="flex justify-end gap-4">
          <Button
            variant="outline"
            className="flex items-center gap-2 hover:bg-gray-50"
            onClick={() => {
              setSourceFile(null);
              setTargetFile(null);
              setMappings([]);
              setShowPreview(false);
            }}
          >
            <RefreshCw className="h-4 w-4" /> Reset Mappings
          </Button>
          <Button
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
            onClick={confirmMappings}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming Mappings...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" /> Trigger the ETL
              </>
            )}
          </Button>
        </div>
      )}

      {/* Modal for Ambiguous Cases */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Ambiguous Mapping</DialogTitle>
            <DialogDescription>
              How would you like to map the fields?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              className="w-full"
              onClick={() => handleModalClose('combine')}
            >
              Combine {currentMapping?.vendor_field} and {currentMapping?.target_field}
            </Button>
            <Button
              className="w-full"
              onClick={() => handleModalClose('first')}
            >
              Use {currentMapping?.vendor_field} only
            </Button>
            <Button
              className="w-full"
              onClick={() => handleModalClose('last')}
            >
              Use {currentMapping?.target_field} only
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
