import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, AlertCircle, Download, RefreshCw, FileSpreadsheet, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FixturePreviewEditor } from "@/components/FixturePreviewEditor";
import * as XLSX from "xlsx";

interface Team {
  id: string;
  name: string;
}

interface FixturesCSVImportProps {
  clubId: string;
  teamId?: string;
  teams?: Team[];
  onImportComplete: () => void;
  isClubAdmin?: boolean;
}

interface ParsedFixture {
  title: string;
  date: string;
  time: string;
  address?: string;
  description?: string;
  reminderHours?: number;
  teamName?: string;
  teamId?: string;
  existingEventId?: string;
  opponent?: string;
}

interface ValidationError {
  row: number;
  message: string;
}

const ACCEPTED_FILE_TYPES = ".csv,.xlsx,.xls";

export function FixturesCSVImport({ clubId, teamId, teams = [], onImportComplete, isClubAdmin = false }: FixturesCSVImportProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedFixtures, setParsedFixtures] = useState<ParsedFixture[]>([]);
  const [duplicateFixtures, setDuplicateFixtures] = useState<ParsedFixture[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [importing, setImporting] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [updateDuplicates, setUpdateDuplicates] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const validateAndParseRows = (rows: string[][]): { fixtures: ParsedFixture[]; errors: ValidationError[] } => {
    const fixtures: ParsedFixture[] = [];
    const errors: ValidationError[] = [];

    if (rows.length < 2) {
      errors.push({ row: 0, message: "File must have a header row and at least one data row" });
      return { fixtures, errors };
    }

    const header = rows[0].map(h => h?.toString().toLowerCase().trim() || '');
    const requiredColumns = ['title', 'date', 'time'];
    const missingColumns = requiredColumns.filter(col => !header.includes(col));

    if (missingColumns.length > 0) {
      errors.push({ row: 1, message: `Missing required columns: ${missingColumns.join(', ')}` });
      return { fixtures, errors };
    }

    const titleIdx = header.indexOf('title');
    const dateIdx = header.indexOf('date');
    const timeIdx = header.indexOf('time');
    const teamIdx = header.indexOf('team');
    const opponentIdx = header.indexOf('opponent');
    const addressIdx = header.indexOf('address');
    const descriptionIdx = header.indexOf('description');
    const reminderIdx = header.indexOf('reminder_hours');

    const teamNameMap = new Map<string, string>();
    for (const team of teams) {
      teamNameMap.set(team.name.toLowerCase().trim(), team.id);
    }

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      const rowNum = i + 1;

      if (!values || values.every(v => !v || v.toString().trim() === '')) continue;

      const title = values[titleIdx]?.toString().trim();
      let date = values[dateIdx]?.toString().trim();
      let time = values[timeIdx]?.toString().trim();

      if (!title) {
        errors.push({ row: rowNum, message: "Title is required" });
        continue;
      }

      if (!date) {
        errors.push({ row: rowNum, message: "Date is required" });
        continue;
      }

      if (typeof values[dateIdx] === 'number') {
        const excelDate = XLSX.SSF.parse_date_code(values[dateIdx]);
        date = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        } else {
          errors.push({ row: rowNum, message: `Invalid date format "${date}". Use YYYY-MM-DD` });
          continue;
        }
      }

      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        errors.push({ row: rowNum, message: `Invalid date "${date}"` });
        continue;
      }

      if (!time) {
        errors.push({ row: rowNum, message: "Time is required" });
        continue;
      }

      if (typeof values[timeIdx] === 'number') {
        const totalMinutes = Math.round(values[timeIdx] * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }

      if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
        errors.push({ row: rowNum, message: `Invalid time format "${time}". Use HH:MM` });
        continue;
      }

      time = time.substring(0, 5);

      const [hours, minutes] = time.split(':').map(Number);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        errors.push({ row: rowNum, message: `Invalid time "${time}"` });
        continue;
      }

      const reminderHoursStr = reminderIdx >= 0 ? values[reminderIdx]?.toString().trim() : undefined;
      let reminderHours: number | undefined;
      if (reminderHoursStr) {
        const parsed = parseInt(reminderHoursStr, 10);
        if (isNaN(parsed) || parsed < 0) {
          errors.push({ row: rowNum, message: `Invalid reminder_hours "${reminderHoursStr}"` });
          continue;
        }
        reminderHours = parsed;
      }

      const teamNameFromFile = teamIdx >= 0 ? values[teamIdx]?.toString().trim() : undefined;
      let resolvedTeamId: string | undefined = teamId;
      
      if (teamNameFromFile) {
        const matchedTeamId = teamNameMap.get(teamNameFromFile.toLowerCase());
        if (matchedTeamId) {
          resolvedTeamId = matchedTeamId;
        } else if (teams.length > 0) {
          errors.push({ row: rowNum, message: `Team "${teamNameFromFile}" not found` });
          continue;
        }
      }

      fixtures.push({
        title,
        date,
        time: time.padStart(5, '0'),
        address: addressIdx >= 0 ? values[addressIdx]?.toString().trim() : undefined,
        description: descriptionIdx >= 0 ? values[descriptionIdx]?.toString().trim() : undefined,
        reminderHours,
        teamName: teamNameFromFile,
        teamId: resolvedTeamId,
        opponent: opponentIdx >= 0 ? values[opponentIdx]?.toString().trim() : undefined,
      });
    }

    const seenFixtures = new Set<string>();
    const uniqueFixtures: ParsedFixture[] = [];
    
    for (const fixture of fixtures) {
      const key = `${fixture.title.toLowerCase()}|${fixture.date}|${fixture.teamId || ''}`;
      if (seenFixtures.has(key)) {
        errors.push({ 
          row: 0, 
          message: `Duplicate: "${fixture.title}" on ${fixture.date}` 
        });
      } else {
        seenFixtures.add(key);
        uniqueFixtures.push(fixture);
      }
    }

    const fixturesWithTeam = uniqueFixtures.filter(f => f.teamName);
    const fixturesWithoutTeam = uniqueFixtures.filter(f => !f.teamName);
    
    if (fixturesWithTeam.length > 0 && fixturesWithoutTeam.length > 0) {
      errors.push({
        row: 0,
        message: `${fixturesWithoutTeam.length} fixture(s) missing team name`
      });
    }

    const uniqueTeamIds = new Set(uniqueFixtures.map(f => f.teamId).filter(Boolean));
    if (!isClubAdmin && uniqueTeamIds.size > 1) {
      errors.push({
        row: 0,
        message: `Multi-team import requires club admin permissions`
      });
    }

    return { fixtures: uniqueFixtures, errors };
  };

  const parseCSV = (content: string): string[][] => {
    const lines = content.trim().split('\n');
    return lines.map(line => parseCSVLine(line));
  };

  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  };

  const parseExcel = (data: ArrayBuffer): string[][] => {
    const workbook = XLSX.read(data, { type: 'array', cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(firstSheet, { 
      header: 1,
      raw: true,
      defval: ''
    });
    return rows.map(row => row.map(cell => cell?.toString() || ''));
  };

  const processFixtures = async (fixtures: ParsedFixture[], parseErrors: ValidationError[], selectedFile: File) => {
    if (fixtures.length > 0) {
      const { data: existingEvents } = await supabase
        .from('events')
        .select('id, title, event_date, team_id')
        .eq('club_id', clubId)
        .eq('type', 'game');
      
      if (existingEvents) {
        const newFixtures: ParsedFixture[] = [];
        const duplicates: ParsedFixture[] = [];
        
        for (const fixture of fixtures) {
          const fixtureDate = fixture.date;
          const fixtureTeamId = fixture.teamId || teamId || null;
          
          const existingEvent = existingEvents.find(event => {
            const eventDate = new Date(event.event_date).toISOString().split('T')[0];
            const titleMatch = event.title.toLowerCase() === fixture.title.toLowerCase();
            const dateMatch = eventDate === fixtureDate;
            const teamMatch = event.team_id === fixtureTeamId;
            return titleMatch && dateMatch && teamMatch;
          });
          
          if (existingEvent) {
            duplicates.push({
              ...fixture,
              existingEventId: existingEvent.id,
            });
          } else {
            newFixtures.push(fixture);
          }
        }
        
        setFile(selectedFile);
        setParsedFixtures(newFixtures);
        setDuplicateFixtures(duplicates);
        setErrors(parseErrors);
        setUpdateDuplicates(false);
        return;
      }
    }
    
    setFile(selectedFile);
    setParsedFixtures(fixtures);
    setDuplicateFixtures([]);
    setErrors(parseErrors);
    setUpdateDuplicates(false);
  };

  const processFile = useCallback(async (selectedFile: File) => {
    const fileName = selectedFile.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (!isCSV && !isExcel) {
      toast({
        title: "Invalid file",
        description: "Please select a CSV or Excel file",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isCSV) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          const rows = parseCSV(content);
          const { fixtures, errors: parseErrors } = validateAndParseRows(rows);
          await processFixtures(fixtures, parseErrors, selectedFile);
        };
        reader.readAsText(selectedFile);
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const data = event.target?.result as ArrayBuffer;
          const rows = parseExcel(data);
          const { fixtures, errors: parseErrors } = validateAndParseRows(rows);
          await processFixtures(fixtures, parseErrors, selectedFile);
        };
        reader.readAsArrayBuffer(selectedFile);
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        title: "Parse error",
        description: "Failed to parse the file",
        variant: "destructive",
      });
    }
  }, [toast, clubId, teamId, teams, isClubAdmin]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processFile(selectedFile);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      await processFile(droppedFile);
    }
  }, [processFile]);

  const handleImport = async () => {
    if (!user) return;
    
    const fixturesToInsert = parsedFixtures;
    const fixturesToUpdate = updateDuplicates ? duplicateFixtures : [];
    
    if (fixturesToInsert.length === 0 && fixturesToUpdate.length === 0) return;

    setImporting(true);
    try {
      let insertedCount = 0;
      let updatedCount = 0;

      if (fixturesToInsert.length > 0) {
        const eventsToInsert = fixturesToInsert.map(fixture => {
          const eventDateTime = new Date(`${fixture.date}T${fixture.time}`);
          return {
            title: fixture.title,
            type: 'game' as const,
            club_id: clubId,
            team_id: fixture.teamId || teamId || null,
            event_date: eventDateTime.toISOString(),
            address: fixture.address || null,
            description: fixture.description || null,
            created_by: user.id,
            reminder_hours_before: fixture.reminderHours || null,
            reminder_sent: false,
            is_recurring: false,
            opponent: fixture.opponent || null,
          };
        });

        const { error: insertError } = await supabase
          .from('events')
          .insert(eventsToInsert);

        if (insertError) throw insertError;
        insertedCount = fixturesToInsert.length;
      }

      if (fixturesToUpdate.length > 0) {
        for (const fixture of fixturesToUpdate) {
          if (!fixture.existingEventId) continue;
          
          const eventDateTime = new Date(`${fixture.date}T${fixture.time}`);
          const { error: updateError } = await supabase
            .from('events')
            .update({
              event_date: eventDateTime.toISOString(),
              address: fixture.address || null,
              description: fixture.description || null,
              reminder_hours_before: fixture.reminderHours || null,
            })
            .eq('id', fixture.existingEventId);

          if (updateError) throw updateError;
          updatedCount++;
        }
      }

      const messages: string[] = [];
      if (insertedCount > 0) messages.push(`${insertedCount} created`);
      if (updatedCount > 0) messages.push(`${updatedCount} updated`);

      toast({
        title: "Fixtures imported",
        description: `Successfully ${messages.join(', ')}`,
      });

      setFile(null);
      setParsedFixtures([]);
      setDuplicateFixtures([]);
      setErrors([]);
      setUpdateDuplicates(false);
      onImportComplete();
    } catch (error) {
      console.error('Error importing fixtures:', error);
      toast({
        title: "Import failed",
        description: "Failed to import fixtures. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setParsedFixtures([]);
    setDuplicateFixtures([]);
    setErrors([]);
    setUpdateDuplicates(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const csvContent = `title,date,time,team,opponent,address,description,reminder_hours
Round 1 vs Eagles,2025-03-15,10:00,U12 Blues,Eagles FC,123 Sports Ground Rd,Home game,24
Round 2 vs Tigers,2025-03-22,14:30,U14 Reds,Tigers United,456 Stadium Ave,Away game,48`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fixtures_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcelTemplate = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['title', 'date', 'time', 'team', 'opponent', 'address', 'description', 'reminder_hours'],
      ['Round 1 vs Eagles', '2025-03-15', '10:00', 'U12 Blues', 'Eagles FC', '123 Sports Ground Rd', 'Home game', 24],
      ['Round 2 vs Tigers', '2025-03-22', '14:30', 'U14 Reds', 'Tigers United', '456 Stadium Ave', 'Away game', 48],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Fixtures');
    XLSX.writeFile(wb, 'fixtures_template.xlsx');
  };

  const totalToImport = parsedFixtures.length + (updateDuplicates ? duplicateFixtures.length : 0);
  const fileType = file?.name.endsWith('.csv') ? 'CSV' : 'Excel';

  return (
    <div className="space-y-4">
      {/* Format Guide - Collapsible */}
      <Collapsible open={formatOpen} onOpenChange={setFormatOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-12">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              <span>File format guide</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${formatOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Required columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="text-xs">title</Badge>
                    <Badge className="text-xs">date</Badge>
                    <Badge className="text-xs">time</Badge>
                  </div>
                </div>
                
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Optional columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-xs">team</Badge>
                    <Badge variant="secondary" className="text-xs">opponent</Badge>
                    <Badge variant="secondary" className="text-xs">address</Badge>
                    <Badge variant="secondary" className="text-xs">description</Badge>
                    <Badge variant="secondary" className="text-xs">reminder_hours</Badge>
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>date:</strong> YYYY-MM-DD (e.g., 2025-03-15)</p>
                <p><strong>time:</strong> 24-hour HH:MM (e.g., 14:30)</p>
                <p><strong>team:</strong> Must match exact team name</p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={downloadExcelTemplate}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                  Excel
                </Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        onChange={handleFileSelect}
        className="hidden"
      />

      {!file ? (
        <Card 
          className={`border-2 border-dashed transition-all cursor-pointer ${
            isDragging 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className={`rounded-full p-4 transition-colors ${
                isDragging ? 'bg-primary/10' : 'bg-muted'
              }`}>
                <Upload className={`h-8 w-8 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="font-medium">
                  {isDragging ? 'Drop file here' : 'Tap to upload'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or drag and drop
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">.csv</Badge>
                <Badge variant="secondary">.xlsx</Badge>
                <Badge variant="secondary">.xls</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 space-y-4">
            {/* File info */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                {file.name.endsWith('.csv') ? (
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm font-medium truncate">{file.name}</span>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="text-sm space-y-1">
                    {errors.slice(0, 3).map((error, i) => (
                      <li key={i}>{error.row > 0 ? `Row ${error.row}: ` : ''}{error.message}</li>
                    ))}
                    {errors.length > 3 && (
                      <li className="text-muted-foreground">+ {errors.length - 3} more errors</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* New fixtures preview */}
            {parsedFixtures.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {parsedFixtures.length} new fixture{parsedFixtures.length !== 1 ? 's' : ''}
                </p>
                <FixturePreviewEditor
                  fixtures={parsedFixtures}
                  onUpdate={setParsedFixtures}
                />
              </div>
            )}

            {/* Duplicate fixtures */}
            {duplicateFixtures.length > 0 && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-amber-600" />
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      {duplicateFixtures.length} existing
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="update-duplicates"
                      checked={updateDuplicates}
                      onCheckedChange={setUpdateDuplicates}
                    />
                    <Label htmlFor="update-duplicates" className="text-sm">
                      Update
                    </Label>
                  </div>
                </div>
                {updateDuplicates && (
                  <FixturePreviewEditor
                    fixtures={duplicateFixtures}
                    onUpdate={setDuplicateFixtures}
                    isDuplicate
                  />
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-12"
                onClick={handleClear}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-12"
                onClick={handleImport}
                disabled={totalToImport === 0 || importing}
              >
                {importing ? 'Importing...' : `Import ${totalToImport}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
