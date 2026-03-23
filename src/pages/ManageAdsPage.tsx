import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Plus, Trash2, ExternalLink, BarChart3, Eye, MousePointer, Settings, ArrowLeft, Pencil, Upload, Loader2 } from "lucide-react";
import { subDays } from "date-fns";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AppAd {
  id: string;
  name: string;
  image_url: string;
  link_url: string | null;
  description: string | null;
  is_active: boolean;
  display_order: number;
}

interface AdSetting {
  id: string;
  location: string;
  is_enabled: boolean;
  override_sponsors: boolean;
  show_only_when_no_sponsors: boolean;
}

export default function ManageAdsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AppAd | null>(null);
  const [newAd, setNewAd] = useState({ name: "", image_url: "", link_url: "", description: "" });
  const [isUploading, setIsUploading] = useState(false);
  const [isEditUploading, setIsEditUploading] = useState(false);
  const newAdFileRef = useRef<HTMLInputElement>(null);
  const editAdFileRef = useRef<HTMLInputElement>(null);

  // Handle image upload for new ad
  const handleNewAdImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `ads/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('app-ads')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('app-ads')
        .getPublicUrl(filePath);

      setNewAd(prev => ({ ...prev, image_url: publicUrl }));
      toast.success("Image uploaded successfully");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
      if (newAdFileRef.current) newAdFileRef.current.value = '';
    }
  };

  // Handle image upload for editing ad
  const handleEditAdImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingAd) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setIsEditUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `ads/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('app-ads')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('app-ads')
        .getPublicUrl(filePath);

      setEditingAd(prev => prev ? { ...prev, image_url: publicUrl } : null);
      toast.success("Image uploaded successfully");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsEditUploading(false);
      if (editAdFileRef.current) editAdFileRef.current.value = '';
    }
  };

  // Check if user is app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch ads
  const { data: ads, isLoading: adsLoading } = useQuery({
    queryKey: ["app-ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as AppAd[];
    },
    enabled: isAppAdmin,
  });

  // Fetch settings
  const { data: settings } = useQuery({
    queryKey: ["app-ad-settings-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("*")
        .order("location");
      if (error) throw error;
      return data as AdSetting[];
    },
    enabled: isAppAdmin,
  });

  // Fetch analytics summary
  const { data: analytics } = useQuery({
    queryKey: ["app-ad-analytics-summary"],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      
      const { data, error } = await supabase
        .from("app_ad_analytics")
        .select("ad_id, event_type, context, created_at")
        .gte("created_at", thirtyDaysAgo);
      
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin,
  });

  // Create ad mutation
  const createAdMutation = useMutation({
    mutationFn: async (ad: typeof newAd) => {
      const { error } = await supabase
        .from("app_ads")
        .insert({
          name: ad.name,
          image_url: ad.image_url,
          link_url: ad.link_url || null,
          description: ad.description || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      setIsDrawerOpen(false);
      setNewAd({ name: "", image_url: "", link_url: "", description: "" });
      toast.success("Ad created successfully");
    },
    onError: () => toast.error("Failed to create ad"),
  });

  // Toggle ad active mutation
  const toggleAdMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("app_ads")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      toast.success("Ad updated");
    },
  });

  // Update ad mutation
  const updateAdMutation = useMutation({
    mutationFn: async (ad: AppAd) => {
      const { error } = await supabase
        .from("app_ads")
        .update({
          name: ad.name,
          image_url: ad.image_url,
          link_url: ad.link_url || null,
          description: ad.description || null,
        })
        .eq("id", ad.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      setEditingAd(null);
      toast.success("Ad updated successfully");
    },
    onError: () => toast.error("Failed to update ad"),
  });

  // Delete ad mutation
  const deleteAdMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_ads")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      toast.success("Ad deleted");
    },
  });

  // Update settings mutation
  const updateSettingMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: boolean }) => {
      const { error } = await supabase
        .from("app_ad_settings")
        .update({ [field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ad-settings-all"] });
      queryClient.invalidateQueries({ queryKey: ["app-ad-settings"] });
      toast.success("Settings updated");
    },
  });

  // Calculate analytics for each ad
  const getAdStats = (adId: string) => {
    if (!analytics) return { views: 0, clicks: 0 };
    const adEvents = analytics.filter(a => a.ad_id === adId);
    return {
      views: adEvents.filter(e => e.event_type === "view").length,
      clicks: adEvents.filter(e => e.event_type === "click").length,
    };
  };

  // Get stats by context
  const getContextStats = (context: string) => {
    if (!analytics) return { views: 0, clicks: 0 };
    const contextEvents = analytics.filter(a => a.context === context);
    return {
      views: contextEvents.filter(e => e.event_type === "view").length,
      clicks: contextEvents.filter(e => e.event_type === "click").length,
    };
  };

  if (!isAppAdmin) {
    return (
      <div className="py-6">
        <div className="p-4 text-center text-muted-foreground">
          You don't have permission to access this page.
        </div>
      </div>
    );
  }

  const locationLabels: Record<string, string> = {
    home: "Home Page",
    events: "Events Page",
    messages: "Messages Page",
  };

  return (
    <div className="py-6 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Manage Ads</h1>
      </div>
      
      <Tabs defaultValue="ads">
        <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ads">Ads</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="ads" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Advertisements</h2>
              <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                <DrawerTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Ad
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <div className="mx-auto w-full max-w-lg">
                    <DrawerHeader>
                      <DrawerTitle>Create New Ad</DrawerTitle>
                      <DrawerDescription>Add a new app-level advertisement</DrawerDescription>
                    </DrawerHeader>
                    <div className="px-4 space-y-4 max-h-[60vh] overflow-y-auto">
                      {/* Image Preview */}
                      {newAd.image_url && (
                        <div className="relative w-full aspect-[3/1] rounded-lg overflow-hidden bg-muted border">
                          <img 
                            src={newAd.image_url} 
                            alt="Ad preview" 
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        <Label htmlFor="ad-name">Ad Name *</Label>
                        <Input
                          id="ad-name"
                          value={newAd.name}
                          onChange={(e) => setNewAd({ ...newAd, name: e.target.value })}
                          placeholder="Enter a name for this ad"
                          className="h-11"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Ad Image *</Label>
                        <div className="flex gap-2">
                          <Input
                            id="ad-image"
                            value={newAd.image_url}
                            onChange={(e) => setNewAd({ ...newAd, image_url: e.target.value })}
                            placeholder="https://example.com/image.jpg"
                            className="h-11 flex-1"
                          />
                          <input
                            type="file"
                            ref={newAdFileRef}
                            accept="image/*"
                            onChange={handleNewAdImageUpload}
                            className="hidden"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => newAdFileRef.current?.click()}
                            disabled={isUploading}
                          >
                            {isUploading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Upload an image or paste a URL. Recommended size: 1200x400px (3:1 ratio)
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="ad-link">Link URL</Label>
                        <Input
                          id="ad-link"
                          value={newAd.link_url}
                          onChange={(e) => setNewAd({ ...newAd, link_url: e.target.value })}
                          placeholder="https://example.com (optional)"
                          className="h-11"
                        />
                        <p className="text-xs text-muted-foreground">
                          Where users go when they tap the ad
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="ad-description">Description</Label>
                        <Textarea
                          id="ad-description"
                          value={newAd.description}
                          onChange={(e) => setNewAd({ ...newAd, description: e.target.value })}
                          placeholder="Brief description for internal reference (optional)"
                          rows={2}
                        />
                      </div>
                    </div>
                    <DrawerFooter>
                      <Button 
                        onClick={() => createAdMutation.mutate(newAd)}
                        disabled={!newAd.name || !newAd.image_url || createAdMutation.isPending}
                        className="w-full"
                      >
                        {createAdMutation.isPending ? "Creating..." : "Create Ad"}
                      </Button>
                      <DrawerClose asChild>
                        <Button variant="outline" className="w-full">Cancel</Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </div>
                </DrawerContent>
              </Drawer>
            </div>

            {adsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : ads && ads.length > 0 ? (
              <div className="space-y-3">
                {ads.map((ad) => {
                  const stats = getAdStats(ad.id);
                  return (
                    <Card key={ad.id}>
                      <CardContent className="p-4">
                        <div className="flex gap-3">
                          <Avatar className="h-16 w-16 rounded-lg">
                            <AvatarImage src={ad.image_url} className="object-cover" />
                            <AvatarFallback className="rounded-lg">{ad.name[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium truncate">{ad.name}</h3>
                              {ad.link_url && (
                                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                            {ad.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{ad.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                {stats.views} views
                              </span>
                              <span className="flex items-center gap-1">
                                <MousePointer className="h-3 w-3" />
                                {stats.clicks} clicks
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={ad.is_active}
                              onCheckedChange={(checked) => 
                                toggleAdMutation.mutate({ id: ad.id, is_active: checked })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingAd(ad)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteAdMutation.mutate(ad.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No ads created yet. Click "Add Ad" to create one.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Edit Ad Drawer */}
          <Drawer open={!!editingAd} onOpenChange={(open) => !open && setEditingAd(null)}>
            <DrawerContent>
              <div className="mx-auto w-full max-w-lg">
                <DrawerHeader>
                  <DrawerTitle>Edit Ad</DrawerTitle>
                  <DrawerDescription>Update advertisement details</DrawerDescription>
                </DrawerHeader>
                {editingAd && (
                  <div className="px-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Image Preview */}
                    {editingAd.image_url && (
                      <div className="relative w-full aspect-[3/1] rounded-lg overflow-hidden bg-muted border">
                        <img 
                          src={editingAd.image_url} 
                          alt="Ad preview" 
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label htmlFor="edit-ad-name">Ad Name *</Label>
                      <Input
                        id="edit-ad-name"
                        value={editingAd.name}
                        onChange={(e) => setEditingAd({ ...editingAd, name: e.target.value })}
                        placeholder="Enter a name for this ad"
                        className="h-11"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Ad Image *</Label>
                      <div className="flex gap-2">
                        <Input
                          id="edit-ad-image"
                          value={editingAd.image_url}
                          onChange={(e) => setEditingAd({ ...editingAd, image_url: e.target.value })}
                          placeholder="https://example.com/image.jpg"
                          className="h-11 flex-1"
                        />
                        <input
                          type="file"
                          ref={editAdFileRef}
                          accept="image/*"
                          onChange={handleEditAdImageUpload}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 shrink-0"
                          onClick={() => editAdFileRef.current?.click()}
                          disabled={isEditUploading}
                        >
                          {isEditUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Upload an image or paste a URL. Recommended size: 1200x400px (3:1 ratio)
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="edit-ad-link">Link URL</Label>
                      <Input
                        id="edit-ad-link"
                        value={editingAd.link_url || ""}
                        onChange={(e) => setEditingAd({ ...editingAd, link_url: e.target.value })}
                        placeholder="https://example.com (optional)"
                        className="h-11"
                      />
                      <p className="text-xs text-muted-foreground">
                        Where users go when they tap the ad
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="edit-ad-description">Description</Label>
                      <Textarea
                        id="edit-ad-description"
                        value={editingAd.description || ""}
                        onChange={(e) => setEditingAd({ ...editingAd, description: e.target.value })}
                        placeholder="Brief description for internal reference (optional)"
                        rows={2}
                      />
                    </div>
                  </div>
                )}
                <DrawerFooter>
                  <Button 
                    onClick={() => editingAd && updateAdMutation.mutate(editingAd)}
                    disabled={!editingAd?.name || !editingAd?.image_url || updateAdMutation.isPending}
                    className="w-full"
                  >
                    {updateAdMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                  <DrawerClose asChild>
                    <Button variant="outline" className="w-full">Cancel</Button>
                  </DrawerClose>
                </DrawerFooter>
              </div>
            </DrawerContent>
          </Drawer>

          <TabsContent value="settings" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Display Settings
                </CardTitle>
                <CardDescription>
                  Configure where and when ads appear in the app
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {settings?.map((setting) => (
                  <div key={setting.id} className="space-y-3 pb-4 border-b last:border-0">
                    <h3 className="font-medium">{locationLabels[setting.location]}</h3>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Enable Ads</Label>
                        <p className="text-xs text-muted-foreground">Show ads on this page</p>
                      </div>
                      <Switch
                        checked={setting.is_enabled}
                        onCheckedChange={(checked) => 
                          updateSettingMutation.mutate({ 
                            id: setting.id, 
                            field: "is_enabled", 
                            value: checked 
                          })
                        }
                      />
                    </div>

                    {setting.is_enabled && (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Override Sponsor Ads</Label>
                            <p className="text-xs text-muted-foreground">Always show app ads instead of sponsor ads</p>
                          </div>
                          <Switch
                            checked={setting.override_sponsors}
                            onCheckedChange={(checked) => 
                              updateSettingMutation.mutate({ 
                                id: setting.id, 
                                field: "override_sponsors", 
                                value: checked 
                              })
                            }
                          />
                        </div>

                        {!setting.override_sponsors && (
                          <div className="flex items-center justify-between">
                            <div>
                              <Label>Show Only When No Sponsors</Label>
                              <p className="text-xs text-muted-foreground">Only show ads if user has no club sponsors</p>
                            </div>
                            <Switch
                              checked={setting.show_only_when_no_sponsors}
                              onCheckedChange={(checked) => 
                                updateSettingMutation.mutate({ 
                                  id: setting.id, 
                                  field: "show_only_when_no_sponsors", 
                                  value: checked 
                                })
                              }
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Analytics (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-3">By Page</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Page</TableHead>
                          <TableHead className="text-right">Views</TableHead>
                          <TableHead className="text-right">Clicks</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {["home_page", "events_page", "messages_page"].map((context) => {
                          const stats = getContextStats(context);
                          const ctr = stats.views > 0 
                            ? ((stats.clicks / stats.views) * 100).toFixed(1) 
                            : "0.0";
                          return (
                            <TableRow key={context}>
                              <TableCell className="capitalize">
                                {context.replace("_page", "").replace("_", " ")}
                              </TableCell>
                              <TableCell className="text-right">{stats.views}</TableCell>
                              <TableCell className="text-right">{stats.clicks}</TableCell>
                              <TableCell className="text-right">{ctr}%</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">By Ad</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ad</TableHead>
                          <TableHead className="text-right">Views</TableHead>
                          <TableHead className="text-right">Clicks</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ads?.map((ad) => {
                          const stats = getAdStats(ad.id);
                          const ctr = stats.views > 0 
                            ? ((stats.clicks / stats.views) * 100).toFixed(1) 
                            : "0.0";
                          return (
                            <TableRow key={ad.id}>
                              <TableCell>{ad.name}</TableCell>
                              <TableCell className="text-right">{stats.views}</TableCell>
                              <TableCell className="text-right">{stats.clicks}</TableCell>
                              <TableCell className="text-right">{ctr}%</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  );
}
