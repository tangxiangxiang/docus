---
title: MRP 作为物料需求计算引擎
created: 2026-06-14
updated: 2026-06-14
tags: [erp, planning, mrp]
source: 
---

# MRP 作为物料需求计算引擎

MRP(Material Requirements Planning,物料需求计划)是 ERP 的核心组件,负责计算需要什么物料、需要多少、何时需要。它从上游接收两个主要输入——主生产计划([[mps-core-planning-layer-erp|MPS]])和物料清单(BOM)——并自动将其逐层展开,得到每个层级、每个组件的需求。作者将 MRP 概括为回答三个具体问题:"需要生产多少、需要什么物料、何时需要"。
