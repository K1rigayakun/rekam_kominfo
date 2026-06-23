import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Users, ArrowLeft, SpinnerGap, CalendarBlank } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { api, API_URL } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { useConfirm } from "../components/useConfirm";

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const { confirm, ConfirmDialog } = useConfirm();
  
  const [team, setTeam] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [selectedUserId, setSelectedUserId] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, activitiesRes, usersRes] = await Promise.all([
        api.get(`/api/teams/${id}`),
        api.get(`/api/activities?team_id=${id}`),
        api.get("/api/users")
      ]);
      setTeam(teamRes.data.data);
      setActivities(activitiesRes.data.data);
      setAllUsers(usersRes.data.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal memuat detail tim");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  async function handleAddMember() {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await api.post(`/api/teams/${id}/members`, {
        user_ids: [selectedUserId]
      });
      toast.success("Anggota berhasil ditambahkan");
      setSelectedUserId("");
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menambah anggota");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    const ok = await confirm({
      title: "Keluarkan Anggota",
      message: "Keluarkan anggota ini dari tim?",
      confirmText: "Keluarkan",
      isDestructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/teams/${id}/members/${userId}`);
      toast.success("Anggota berhasil dikeluarkan");
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal mengeluarkan anggota");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <SpinnerGap className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (!team) return null;

  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl mx-auto p-4 lg:p-8"
    >
      <ConfirmDialog />
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate("/teams")}
          className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl premium-transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-primary-600" />
            <AnimatedText text={team.name} />
          </h1>
          {team.description && (
            <p className="text-text-muted text-sm mt-1">{team.description}</p>
          )}
          {team.tag_name && (
            <div className="mt-2 flex">
              <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-md border border-indigo-100">
                {team.tag_name}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Members */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Anggota Tim</h2>
            
            {isAdmin && (
              <div className="flex gap-2 mb-4">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none text-sm"
                >
                  <option value="">-- Pilih User --</option>
                  {allUsers
                    .filter(u => !team.members?.find((m: any) => m.id === u.id))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddMember}
                  disabled={saving || !selectedUserId}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold premium-transition shrink-0"
                >
                  {saving ? <SpinnerGap className="w-4 h-4 animate-spin" /> : "Tambah"}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {!team.members || team.members.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">Belum ada anggota.</p>
              ) : (
                team.members.map((m: any) => (
                  <div key={m.id} className="flex justify-between items-center p-3 border border-gray-100 rounded-xl bg-gray-50">
                    <div>
                        <p className="text-sm font-bold text-gray-900">{m.full_name}</p>
                        <p className="text-xs text-gray-500">{m.username}</p>
                      </div>
                    {isAdmin && (
                      <button
                        onClick={() => handleRemoveMember(m.id)}
                        className="text-xs font-semibold text-red-500 hover:text-red-700 px-2 py-1 bg-red-50 hover:bg-red-100 rounded-md premium-transition"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Activities */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Acara yang Diikuti / Diupload</h2>
            
            <div className="space-y-3">
              {activities.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl">
                  <CalendarBlank className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Belum ada acara terkait tim ini.</p>
                </div>
              ) : (
                activities.map(act => (
                  <div 
                    key={act.id} 
                    onClick={() => navigate(`/activity/${act.id}`)}
                    className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl hover:border-primary-200 hover:shadow-md cursor-pointer premium-transition group"
                  >
                    {act.thumbnail_media_id ? (
                      <img 
                        src={`${API_URL}/api/media/${act.thumbnail_media_id}/download?quality=preview&inline=true&token=${token}`} 
                        alt="" 
                        className="w-16 h-16 rounded-xl object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 text-gray-300 group-hover:bg-primary-50 group-hover:text-primary-500 transition-colors">
                        <CalendarBlank className="w-6 h-6" weight="duotone" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-base font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{act.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{new Date(act.event_date).toLocaleDateString('id-ID', { dateStyle: 'long' })}</span>
                        {act.district_name && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                            <span>{act.district_name}</span>
                          </>
                        )}
                        <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                        <span>{act.media_count || 0} Media</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
