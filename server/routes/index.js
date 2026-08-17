import express from 'express';
import authRoutes from './auth.js';
import campaignRoutes from './campaign.js';
import characterRoutes from './characters.js';
import mapRoutes from './map.js';
import partyRoutes from './party.js';
import travelRoutes from './travel.js';
import journeyRoutes from './journeys.js';
import rollRoutes from './rolls.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/campaign', campaignRoutes);
router.use('/characters', characterRoutes);
router.use('/map', mapRoutes);
router.use('/party', partyRoutes);
router.use('/travel', travelRoutes);
router.use('/journeys', journeyRoutes);
router.use('/rolls', rollRoutes);

export default router;
