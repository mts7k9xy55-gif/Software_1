import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, Zap, Target, Globe } from 'lucide-react';

interface ReportData {
  industries: any[];
  technologies: any[];
  strategic_roadmap: any[];
  market_insights: any;
}

export default function Home() {
  const [data, setData] = useState<ReportData | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState('care');
  const [selectedTech, setSelectedTech] = useState<number | null>(null);

  useEffect(() => {
    fetch('/report-data.json')
      .then(res => res.json())
      .then(data => setData(data))
      .catch(err => console.error('Failed to load report data:', err));
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">レポートを読み込み中...</p>
        </div>
      </div>
    );
  }

  const currentIndustry = data.industries.find(ind => ind.id === selectedIndustry);
  const marketData = data.industries.map(ind => ({
    name: ind.name,
    size: ind.market_size_trillion_yen,
    growth: (ind.growth_rate * 100).toFixed(1)
  }));

  const techScatterData = data.technologies.map(tech => ({
    name: tech.name,
    versatility: tech.versatility,
    economic_scale: tech.economic_scale,
    priority: tech.priority,
    roi: tech.roi_potential
  }));

  const priorityData = data.technologies
    .sort((a, b) => a.priority - b.priority)
    .map(tech => ({
      name: tech.name.substring(0, 15),
      priority: tech.priority,
      roi: tech.roi_potential,
      versatility: tech.versatility
    }));

  const phaseData = data.strategic_roadmap.map(phase => ({
    phase: phase.phase.split(':')[0],
    adoption: parseFloat(phase.expected_adoption.split('-')[1]),
    revenue: parseFloat(phase.revenue_potential.split('-')[1])
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">AI産業アタッチメント戦略</h1>
              <p className="text-slate-600 mt-1">介護・美容・飲食業界のAI導入遅延領域への事業機会分析</p>
            </div>
            <div className="hidden md:flex gap-2 text-sm text-slate-600">
              <div className="flex items-center gap-1"><Globe className="w-4 h-4" /> 日本国内+アジア展開</div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Executive Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="bg-white hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                総市場規模
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">70.7兆円</div>
              <p className="text-xs text-slate-500 mt-1">日本国内（介護+美容+飲食）</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-600" />
                AI導入率
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">8-12%</div>
              <p className="text-xs text-slate-500 mt-1">業界平均（導入遅延）</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Target className="w-4 h-4 text-green-600" />
                推奨技術数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">6個</div>
              <p className="text-xs text-slate-500 mt-1">優先度付き戦略</p>
            </CardContent>
          </Card>

          <Card className="bg-white hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-600" />
                国際展開
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">150兆円</div>
              <p className="text-xs text-slate-500 mt-1">アジア市場機会</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="market" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 bg-white border border-slate-200">
            <TabsTrigger value="market">市場規模</TabsTrigger>
            <TabsTrigger value="technologies">技術分析</TabsTrigger>
            <TabsTrigger value="roadmap">戦略ロードマップ</TabsTrigger>
            <TabsTrigger value="details">詳細情報</TabsTrigger>
          </TabsList>

          {/* Market Tab */}
          <TabsContent value="market" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>各産業の市場規模と成長率</CardTitle>
                <CardDescription>2025年時点の市場規模と年平均成長率</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={marketData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" />
                    <YAxis yAxisId="left" label={{ value: '市場規模（兆円）', angle: -90, position: 'insideLeft' }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: '成長率（%）', angle: 90, position: 'insideRight' }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="size" fill="#3b82f6" name="市場規模（兆円）" />
                    <Bar yAxisId="right" dataKey="growth" fill="#10b981" name="成長率（%）" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.industries.map((ind: any) => (
                <Card key={ind.id} className={`cursor-pointer transition-all ${
                  selectedIndustry === ind.id ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:shadow-lg'
                }`} onClick={() => setSelectedIndustry(ind.id)}>
                  <CardHeader>
                    <CardTitle className="text-lg">{ind.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <p className="text-sm text-slate-600">市場規模</p>
                      <p className="text-xl font-bold text-slate-900">{ind.market_size_trillion_yen}兆円</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-600">成長率</p>
                      <p className="text-lg font-semibold text-green-600">{(ind.growth_rate * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-600">小規模事業者比率</p>
                      <p className="text-lg font-semibold text-blue-600">{(ind.small_business_ratio * 100).toFixed(0)}%</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Technologies Tab */}
          <TabsContent value="technologies" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>技術の汎用性 vs 経済規模</CardTitle>
                <CardDescription>各技術の汎用性（Y軸）と経済規模への影響（X軸）を分析</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="economic_scale" name="経済規模" />
                    <YAxis dataKey="versatility" name="汎用性" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter name="技術" data={techScatterData} fill="#3b82f6" />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>優先度別技術ランキング</CardTitle>
                <CardDescription>ROI潜在力と汎用性に基づく優先順位</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={priorityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="roi" fill="#3b82f6" name="ROI潜在力" />
                    <Bar dataKey="versatility" fill="#10b981" name="汎用性" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.technologies.map((tech: any) => (
                <Card key={tech.id} className={`cursor-pointer transition-all ${
                  selectedTech === tech.id ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:shadow-lg'
                }`} onClick={() => setSelectedTech(selectedTech === tech.id ? null : tech.id)}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{tech.name}</CardTitle>
                        <CardDescription>優先度: {tech.priority}</CardDescription>
                      </div>
                      <span className="text-2xl font-bold text-blue-600">#{tech.priority}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-slate-600">汎用性</p>
                        <p className="font-semibold text-slate-900">{tech.versatility}/10</p>
                      </div>
                      <div>
                        <p className="text-slate-600">経済規模</p>
                        <p className="font-semibold text-slate-900">{tech.economic_scale}/10</p>
                      </div>
                      <div>
                        <p className="text-slate-600">ROI</p>
                        <p className="font-semibold text-slate-900">{tech.roi_potential}/10</p>
                      </div>
                      <div>
                        <p className="text-slate-600">回収期間</p>
                        <p className="font-semibold text-slate-900">{tech.payback_months}ヶ月</p>
                      </div>
                    </div>
                    {selectedTech === tech.id && (
                      <div className="pt-2 border-t border-slate-200 space-y-2">
                        <p className="text-sm text-slate-700">{tech.description}</p>
                        <div>
                          <p className="text-xs font-semibold text-slate-600 mb-1">対象業界:</p>
                          <div className="flex gap-1 flex-wrap">
                            {tech.industries.map((ind: string) => (
                              <span key={ind} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">{ind}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Roadmap Tab */}
          <TabsContent value="roadmap" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>戦略的ロードマップ</CardTitle>
                <CardDescription>4フェーズの実装戦略と期待される採用率・収益</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={phaseData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="phase" />
                    <YAxis yAxisId="left" label={{ value: '採用率（%）', angle: -90, position: 'insideLeft' }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: '収益潜在力（億円）', angle: 90, position: 'insideRight' }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="adoption" stroke="#3b82f6" name="採用率（%）" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#10b981" name="収益潜在力（億円）" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {data.strategic_roadmap.map((phase: any, idx: number) => (
                <Card key={idx}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle>{phase.phase}</CardTitle>
                        <CardDescription>{phase.timeline}</CardDescription>
                      </div>
                      <span className="text-sm font-semibold px-3 py-1 bg-blue-100 text-blue-700 rounded">{phase.expected_adoption}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-700">{phase.focus}</p>
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-2">推奨技術:</p>
                      <div className="flex gap-2 flex-wrap">
                        {phase.technologies.map((tech: string) => (
                          <span key={tech} className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded">{tech}</span>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-slate-200">
                      <div>
                        <p className="text-slate-600">対象市場</p>
                        <p className="font-semibold text-slate-900">{phase.target_market}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">収益潜在力</p>
                        <p className="font-semibold text-slate-900">{phase.revenue_potential}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>市場インサイト</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold text-slate-900 mb-2">総市場規模</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded">
                      <p className="text-sm text-slate-600">日本国内</p>
                      <p className="text-xl font-bold text-slate-900">{data.market_insights.total_addressable_market.japan}兆円</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded">
                      <p className="text-sm text-slate-600">アジア市場</p>
                      <p className="text-xl font-bold text-slate-900">{data.market_insights.total_addressable_market.asia}兆円</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-900 mb-2">導入障壁</h4>
                  <ul className="space-y-2">
                    {Object.entries(data.market_insights.adoption_barriers).map(([key, value]) => (
                      <li key={key} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-blue-600 font-bold mt-0.5">•</span>
                        <span><strong>{key}:</strong> {value as string}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-900 mb-2">資金流入経路</h4>
                  <ul className="space-y-2">
                    {data.market_insights.funding_sources.map((source: string, idx: number) => (
                      <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-green-600 font-bold mt-0.5">✓</span>
                        <span>{source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            {currentIndustry && (
              <Card>
                <CardHeader>
                  <CardTitle>{currentIndustry.name}業界の詳細</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-700">{currentIndustry.description}</p>
                  
                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">主要課題</h4>
                    <ul className="space-y-2">
                      {currentIndustry.key_challenges.map((challenge: string, idx: number) => (
                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-red-600 font-bold">✗</span>
                          <span>{challenge}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900 mb-2">AI活用ソリューション</h4>
                    <ul className="space-y-1">
                      {currentIndustry.ai_solutions.map((solution: string, idx: number) => (
                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                          <span className="text-green-600 font-bold">✓</span>
                          <span>{solution}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 mt-12 py-8">
        <div className="container mx-auto px-4 text-center text-sm">
          <p>AI産業アタッチメント戦略レポート | 介護・美容・飲食業界のAI導入機会分析</p>
          <p className="mt-2 text-slate-500">© 2026 Strategic AI Initiative</p>
        </div>
      </footer>
    </div>
  );
}
