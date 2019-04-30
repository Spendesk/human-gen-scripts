require("dotenv").config();
const axios = require("axios");
const _ = require("lodash");
const Closeio = require("close.io");
const csv = require("csvtojson");

const API_KEY = process.env.CLOSEIO_APIKEY;
const closeio = new Closeio(API_KEY);

async function getCachedData(scraperTag, historyTag) {
  return await axios.get(
    `https://scrapers-cache.herokuapp.com/scrapers/${scraperTag}/${historyTag}`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${process.env.CACHE_TOKEN}`
      }
    }
  );
}

async function getCompanyInfos(companyLinkedinUrl) {
  const linkedinCompanyHistoryTag = (companyLinkedinUrl.match(
    /www.linkedin.com\/company\/(.*)(\/|)/
  ) || [])[1];
  const linkedinCompany = _.get(
    await getCachedData("linkedinCompany", linkedinCompanyHistoryTag),
    "data.data"
  );
  const salesNavigatorCompanyHistoryTag = (linkedinCompany.data[
    "*elements"
  ][0].match(/urn:li:fs_normalized_company:(.*)/) || [])[1];
  const salesNavigatorCompany = _.get(
    await getCachedData(
      "salesNavigatorCompany",
      salesNavigatorCompanyHistoryTag
    ),
    "data.data"
  );

  return {
    linkedinCompany,
    salesNavigatorCompany
  };
}

async function getCloseioCompany(companyLinkedinUrl) {
  const query = `linkedin_company:"${companyLinkedinUrl}"`;
  try {
    const response = await axios.get(
      `https://api.close.com/api/v1/lead/?query=${query}`,
      {
        auth: {
          username: API_KEY
        }
      }
    );
    return response.data.data[0];
  } catch (error) {
    console.log("Got error:", error);
  }
}

async function updateCompanyFTE(fte, company) {
  const response = await closeio.lead.update(company.id, {
    "custom.lcf_CpqzI0t50mc3P052ZlAy9YAx2iC2ofOPDUNUHPHCcrG": fte
  });
}

async function updateCompanyLocations(locations, company) {
  const finalLocations = locations.map(el => {
    return {
      address_1: el.line1,
      address_2: el.line2 || "",
      city: el.city,
      state: el.geographicArea || "",
      zipcode: el.postalCode || "",
      country: el.country
    };
  });
  const response = await closeio.lead.update(company.id, {
    addresses: finalLocations
  });
}

async function updateCompanyFunding(funding, company) {
  const lastFR = funding.lastFundingRound;
  const date = `${lastFR.announcedOn.day}/${lastFR.announcedOn.month}/${
    lastFR.announcedOn.year
  }`;
  const response = await closeio.lead.update(company.id, {
    "custom.lcf_9Z3LDpeub9fpLx6G7r9g2EGw0yTzAcH39giBGTWkZRk":
      lastFR.moneyRaised.amount,
    "custom.lcf_h0rUN4DUjTKmNgyTvX6ViHyW7K0oSel4kQuNKaPnj4z": date,
    "custom.lcf_5X1PGJB0YSCBO9wVW833wFnVHz59PvnnWD0pfjmwdxh": lastFR.fundingType
  });
}

async function updateCompany(companyLinkedinUrl) {
  const updated = {
    fte: false,
    locations: false,
    funding: false
  };
  const { linkedinCompany, salesNavigatorCompany } = await getCompanyInfos(
    companyLinkedinUrl
  );
  let locations = linkedinCompany.included.find(el => !!el.confirmedLocations);
  let funding = linkedinCompany.included.find(el => !!el.fundingData);
  const fte = salesNavigatorCompany.employeeCount;
  const closeCompany = await getCloseioCompany(companyLinkedinUrl);
  if (fte) {
    await updateCompanyFTE(fte, closeCompany);
    updated.fte = true;
  }
  if (
    locations &&
    locations.confirmedLocations &&
    locations.confirmedLocations.length > 0
  ) {
    await updateCompanyLocations(locations.confirmedLocations, closeCompany);
    updated.locations = true;
  }
  if (funding && funding.fundingData) {
    await updateCompanyFunding(funding.fundingData, closeCompany);
    updated.funding = true;
  }
  return updated;
}

(async () => {
  const data = await csv().fromFile("./leads.csv");
  count = 1;
  if (data.length > 0) {
    for (const company of data) {
      try {
        console.log(
          `🏗️  (${count}/${data.length}) Updating ${
            company.companyLinkedinUrl
          }...`
        );
        const updated = await updateCompany(company.companyLinkedinUrl);
        console.log(
          `✅ (${count}/${data.length}) Successfuly updated ${
            company.companyLinkedinUrl
          } : ${JSON.stringify(updated)}.`
        );
      } catch (error) {
        console.log(
          `❌ (${count}/${data.length}) Could not update ${
            company.companyLinkedinUrl
          } because of error : ${error}`
        );
      }
      count++;
    }
  }
  process.exit();
})();
